/**
 * Ritsu 原生/数据库桥接层
 *
 * 在 v7.1 中，移除了 Rust napi-rs 插件。
 * 统一使用 Bun 内置的高性能 bun:sqlite 引擎在 JS 侧直接处理 SQL 存储与向量余弦计算，
 * 解决 Windows/mac/Linux 的编译分发与交叉编译难题，且无数据序列化跨边界开销。
 */

import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { detectProjectRoot } from "./project-root.js";
import { jaccardSimilarity, cosineSimilarity } from "./similarity.js";

type SearchResult = {
  id: string;
  score: number;
  metadata: string;
};

// 全局单例数据库连接
let vectorDb: Database | null = null;
let ctxDb: Database | null = null;
let currentVectorDbPath: string | null = null;
let currentCtxDbPath: string | null = null;

export function isNativeAvailable(): boolean {
  // 我们现在把纯 JS+bun:sqlite 视作稳定可用的数据库服务层
  return true;
}

// ─── Vector Store (向量检索，用于违规相似度匹配) ─────────────────

export function initNativeStore(customRoot?: string): boolean {
  const root = customRoot || detectProjectRoot();
  const dbPath = resolve(root, ".ritsu", "vectors.db");

  if (vectorDb && currentVectorDbPath === dbPath) return true;

  if (vectorDb) {
    try {
      vectorDb.close();
    } catch { /* skip */ }
    vectorDb = null;
  }

  try {
    const dir = resolve(root, ".ritsu");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { mkdirSync, existsSync } = require("node:fs");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    vectorDb = new Database(dbPath, { create: true });
    currentVectorDbPath = dbPath;
    
    // 执行必要的 PRAGMA 与建表
    vectorDb.run("PRAGMA journal_mode = WAL;");
    vectorDb.run("PRAGMA synchronous = NORMAL;");
    vectorDb.run(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT NOT NULL,
        collection TEXT NOT NULL,
        embedding TEXT NOT NULL,
        metadata TEXT,
        PRIMARY KEY (collection, id)
      );
    `);
    vectorDb.run(`
      CREATE INDEX IF NOT EXISTS idx_vectors_collection ON vectors(collection);
    `);
    return true;
  } catch (e) {
    console.error("[ritsu-database] Failed to init vector store:", e);
    return false;
  }
}

export function closeNativeStore(): void {
  if (vectorDb) {
    try {
      vectorDb.close();
    } catch { /* skip */ }
    vectorDb = null;
  }
}

export function indexViolationEmbedding(
  violationId: string,
  text: string,
  metadata: Record<string, unknown>,
): boolean {
  if (!vectorDb) initNativeStore();
  if (!vectorDb) return false;

  try {
    const embedding = computeSimpleEmbedding(text);
    const embeddingJson = JSON.stringify(embedding);
    // 注入 _text 以便后续的高效字面量/Jaccard 粗筛，无需做复杂的 n-gram 向量计算与余弦比对
    const metadataStr = JSON.stringify({ ...metadata, _text: text });

    const query = vectorDb.prepare(`
      INSERT OR REPLACE INTO vectors (collection, id, embedding, metadata)
      VALUES (?1, ?2, ?3, ?4)
    `);
    query.run("violations", violationId, embeddingJson, metadataStr);
    return true;
  } catch (e) {
    console.error("[ritsu-database] index error:", e);
    return false;
  }
}

export function searchSimilarViolations(
  queryText: string,
  topK: number,
): SearchResult[] {
  if (!vectorDb) initNativeStore();
  if (!vectorDb) return [];

  try {
    const stmt = vectorDb.prepare(
      "SELECT id, embedding, metadata FROM vectors WHERE collection = 'violations'"
    );
    const rows = stmt.all() as { id: string; embedding: string; metadata: string | null }[];

    const results: SearchResult[] = [];

    for (const row of rows) {
      try {
        let text = "";
        let metaObj: Record<string, unknown> = {};
        if (row.metadata) {
          metaObj = JSON.parse(row.metadata) as Record<string, unknown>;
          if (typeof metaObj._text === "string") {
            text = metaObj._text;
          } else if (typeof metaObj.rule_id === "string" && typeof metaObj.evidence === "string") {
            text = `${metaObj.rule_id} ${metaObj.evidence}`;
          }
        }

        // 计算高效的 Jaccard 相似度作为字面粗筛分数
        // 如果 text 为空，则降级为老的余弦相似度计算
        let score = 0;
        if (text) {
          score = jaccardSimilarity(queryText, text);
        } else {
          const queryEmbedding = computeSimpleEmbedding(queryText);
          const emb = JSON.parse(row.embedding) as number[];
          score = cosineSimilarity(queryEmbedding, emb);
        }

        results.push({
          score,
          id: row.id,
          metadata: row.metadata ?? "",
        });
      } catch { /* skip */ }
    }

    // 按得分降序排列
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  } catch (e) {
    console.error("[ritsu-database] search error:", e);
    return [];
  }
}

export function removeEmbedding(collection: string, id: string): boolean {
  if (!vectorDb) initNativeStore();
  if (!vectorDb) return false;

  try {
    const query = vectorDb.prepare(
      "DELETE FROM vectors WHERE collection = ?1 AND id = ?2"
    );
    query.run(collection, id);
    return true;
  } catch (e) {
    console.error("[ritsu-database] remove error:", e);
    return false;
  }
}

// ─── Ctx Store (阶段上下文事件存取) ──────────────────────────────

export function initCtxStore(customRoot?: string): boolean {
  const root = customRoot || detectProjectRoot();
  const dbPath = resolve(root, ".ritsu", "ctx.db");

  if (ctxDb && currentCtxDbPath === dbPath) return true;

  if (ctxDb) {
    try {
      ctxDb.close();
    } catch { /* skip */ }
    ctxDb = null;
  }

  try {
    const dir = resolve(root, ".ritsu");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { mkdirSync, existsSync, readFileSync } = require("node:fs");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    ctxDb = new Database(":memory:", { create: true });
    currentCtxDbPath = dbPath;

    ctxDb.run("PRAGMA journal_mode = WAL;");
    ctxDb.run("PRAGMA synchronous = NORMAL;");
    ctxDb.run(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        correlation_id TEXT,
        trace_id TEXT,
        span_id TEXT,
        skill TEXT,
        domain TEXT,
        status TEXT NOT NULL,
        step TEXT,
        artifact TEXT,
        data TEXT NOT NULL
      );
    `);
    
    // 创建高性能索引
    ctxDb.run("CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);");
    ctxDb.run("CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);");
    ctxDb.run("CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events(correlation_id);");
    ctxDb.run("CREATE INDEX IF NOT EXISTS idx_events_trace_id ON events(trace_id);");
    ctxDb.run("CREATE INDEX IF NOT EXISTS idx_events_skill ON events(skill);");
    
    // JIT Loader: 读取当月 JSONL 文件并预热内存数据库
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const jsonlPath = resolve(root, ".ritsu", `ctx-${yyyy}-${mm}.jsonl`);

    if (existsSync(jsonlPath)) {
      const content = readFileSync(jsonlPath, "utf-8");
      const insertStmt = ctxDb.prepare(`
        INSERT INTO events (ts, correlation_id, trace_id, span_id, skill, domain, status, step, artifact, data)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
      `);

      const getStr = (event: Record<string, unknown>, key: string): string => {
        const val = event[key];
        return typeof val === "string" ? val : "";
      };

      const legacyCidToTraceId = (cid: string) => cid.replace(/^cid-/, "tr-");
      const legacyCidToSpanId = (cid: string) => cid.replace(/^cid-/, "sp-");

      const insertTransaction = ctxDb.transaction((lines: string[]) => {
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let parsed: Record<string, unknown> | null = null;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            const healed = tryHealJsonLine(trimmed);
            if (healed) {
              try {
                parsed = JSON.parse(healed);
              } catch { /* skip */ }
            }
          }

          if (parsed) {
            if (parsed.correlation_id && !parsed.trace_id) {
              parsed.trace_id = legacyCidToTraceId(String(parsed.correlation_id));
              parsed.span_id = legacyCidToSpanId(String(parsed.correlation_id));
            }
            if (!parsed.correlation_id && parsed.trace_id) {
              parsed.correlation_id = parsed.trace_id;
            }

            insertStmt.run(
              getStr(parsed, "ts"),
              getStr(parsed, "correlation_id"),
              getStr(parsed, "trace_id"),
              getStr(parsed, "span_id"),
              getStr(parsed, "skill"),
              getStr(parsed, "domain"),
              getStr(parsed, "status"),
              getStr(parsed, "step"),
              getStr(parsed, "artifact"),
              JSON.stringify(parsed)
            );
          }
        }
      });

      const lines = content.split("\n");
      insertTransaction(lines);
    }

    return true;
  } catch (e) {
    console.error("[ritsu-database] Failed to init ctx store:", e);
    return false;
  }
}

export function closeCtxStore(): void {
  if (ctxDb) {
    try {
      ctxDb.close();
    } catch { /* skip */ }
    ctxDb = null;
    currentCtxDbPath = null;
  }
}

export function ctxQueryCount(customRoot?: string): number {
  if (!ctxDb) initCtxStore(customRoot);
  if (!ctxDb) return 0;
  try {
    const row = ctxDb.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number } | undefined;
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

export function ctxInsert(event: Record<string, unknown>): boolean {
  if (!ctxDb) initCtxStore();
  if (!ctxDb) return false;

  try {
    const getStr = (key: string): string => {
      const val = event[key];
      return typeof val === "string" ? val : "";
    };

    const eventJson = JSON.stringify(event);

    const query = ctxDb.prepare(`
      INSERT INTO events (ts, correlation_id, trace_id, span_id, skill, domain, status, step, artifact, data)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    `);
    query.run(
      getStr("ts"),
      getStr("correlation_id"),
      getStr("trace_id"),
      getStr("span_id"),
      getStr("skill"),
      getStr("domain"),
      getStr("status"),
      getStr("step"),
      getStr("artifact"),
      eventJson,
    );
    return true;
  } catch (e) {
    console.error("[ritsu-database] ctx insert error:", e);
    return false;
  }
}

export function ctxClear(): void {
  if (!ctxDb) initCtxStore();
  if (!ctxDb) return;
  try {
    ctxDb.run("DELETE FROM events");
    ctxDb.run("DELETE FROM sqlite_sequence WHERE name='events'");
  } catch (e) {
    console.error("[ritsu-database] ctx clear error:", e);
  }
}

export function ctxQueryLastIncomplete(): Record<string, unknown> | null {
  if (!ctxDb) initCtxStore();
  if (!ctxDb) return null;

  try {
    const row = ctxDb
      .prepare(`
        SELECT data FROM events 
        WHERE status = 'started' 
          AND correlation_id NOT IN (
            SELECT correlation_id FROM events WHERE status IN ('done', 'failed')
          )
        ORDER BY id DESC LIMIT 1
      `)
      .get() as { data: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function ctxQueryLastCompleted(): Record<string, unknown> | null {
  if (!ctxDb) initCtxStore();
  if (!ctxDb) return null;

  try {
    const row = ctxDb
      .prepare("SELECT data FROM events WHERE status = 'done' ORDER BY id DESC LIMIT 1")
      .get() as { data: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function ctxQueryRecent(limit = 50): Record<string, unknown>[] {
  if (!ctxDb) initCtxStore();
  if (!ctxDb) return [];

  try {
    const rows = ctxDb
      .prepare("SELECT data FROM events ORDER BY id DESC LIMIT ?1")
      .all(limit) as { data: string }[];
    const result = rows.map((row) => JSON.parse(row.data) as Record<string, unknown>);
    return result.reverse();
  } catch {
    return [];
  }
}

export function ctxQueryAll(limit = 10000): Record<string, unknown>[] {
  if (!ctxDb) initCtxStore();
  if (!ctxDb) return [];

  try {
    const rows = ctxDb
      .prepare("SELECT data FROM events ORDER BY id ASC LIMIT ?1")
      .all(limit) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as Record<string, unknown>);
  } catch {
    return [];
  }
}

// ─── Embedding ────────────────────────────────────────────────

/**
 * 简单嵌入向量计算 — 基于字符 n-gram 的哈希特征。
 * 维数为 128。
 */
export function computeSimpleEmbedding(text: string, dimensions = 128): number[] {
  const vec = new Array(dimensions).fill(0);
  const normalized = text.toLowerCase().trim();

  // Character bigram hash features
  for (let i = 0; i < normalized.length - 1; i++) {
    const bigram = normalized.slice(i, i + 2);
    let hash = 0;
    for (let j = 0; j < bigram.length; j++) {
      hash = ((hash << 5) - hash + bigram.charCodeAt(j)) | 0;
    }
    const idx = Math.abs(hash) % dimensions;
    vec[idx] += 1;
  }

  // Word-level features
  const words = normalized.split(/\s+/);
  for (const word of words) {
    if (word.length < 2) continue;
    let hash = 0;
    for (let j = 0; j < word.length; j++) {
      hash = ((hash << 5) - hash + word.charCodeAt(j)) | 0;
    }
    const idx = Math.abs(hash) % dimensions;
    vec[idx] += 2;
  }

  // Normalize to unit vector
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < dimensions; i++) {
      vec[i] /= magnitude;
    }
  }

  return vec;
}

function tryHealJsonLine(line: string): string | null {
  let trimmed = line.trim();
  if (!trimmed) return null;

  let openBraces = 0;
  let openBrackets = 0;
  let inQuote = false;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote) {
      if (char === "{") openBraces++;
      else if (char === "}") openBraces--;
      else if (char === "[") openBrackets++;
      else if (char === "]") openBrackets--;
    }
  }

  if (inQuote) {
    trimmed += '"';
  }

  while (openBrackets > 0) {
    trimmed += "]";
    openBrackets--;
  }

  while (openBraces > 0) {
    trimmed += "}";
    openBraces--;
  }

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

