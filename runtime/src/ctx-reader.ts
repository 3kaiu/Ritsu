/**
 * ctx 读取器 — 查询 JSONL 事件记录
 *
 * P1-5 修复：从 ctx-store.ts 拆分，职责聚焦于读取。
 * P1-6 修复：无 WASM 依赖，无循环依赖。
 * P2-1 优化：内存占用优化，避免大文件 split('\n')。
 */

import { existsSync, readFileSync, statSync, openSync, readSync, closeSync, appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getCtxPath } from "./ctx-path.js";
import { legacyCidToTraceId, legacyCidToSpanId } from "./correlation.js";

let cachedEntries: Record<string, unknown>[] | null = null;
let lastMtime: number = 0;
let lastSize: number = 0;
let lastPath: string = "";

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

function quarantineLine(projectRoot: string, line: string): void {
  try {
    const dir = resolve(projectRoot, ".ritsu");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(resolve(dir, "corrupted.jsonl"), line + "\n", "utf-8");
  } catch {
    // fail-safe
  }
}

function processLine(
  line: string,
  projectRoot: string,
  entries: Record<string, unknown>[],
  skippedCountRef: { value: number }
): void {
  try {
    const parsed = JSON.parse(line);
    if (parsed.correlation_id && !parsed.trace_id) {
      parsed.trace_id = legacyCidToTraceId(parsed.correlation_id);
      parsed.span_id = legacyCidToSpanId(parsed.correlation_id);
    }
    if (!parsed.correlation_id && parsed.trace_id) {
      parsed.correlation_id = parsed.trace_id;
    }
    entries.push(parsed);
  } catch (err) {
    if (process.env.RITSU_STRICT_JSONL === "1") {
      throw new Error(`JSONL Parse Error: ${(err as Error).message} on line: ${line}`);
    }

    const healed = tryHealJsonLine(line);
    if (healed) {
      try {
        const parsed = JSON.parse(healed);
        if (parsed.correlation_id && !parsed.trace_id) {
          parsed.trace_id = legacyCidToTraceId(parsed.correlation_id);
          parsed.span_id = legacyCidToSpanId(parsed.correlation_id);
        }
        if (!parsed.correlation_id && parsed.trace_id) {
          parsed.correlation_id = parsed.trace_id;
        }
        entries.push(parsed);
        return;
      } catch {
        // fallback to quarantine
      }
    }

    skippedCountRef.value++;
    quarantineLine(projectRoot, line);
    entries.push({
      event: "system_warning",
      type: "corrupted_jsonl_line",
      message: `Corrupted line quarantined: ${line.slice(0, 100)}`,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * 核心读取逻辑：优先使用缓存，若文件变动则重新解析。
 * 优化：对于 JSONL，逐行解析比全量 split 内存更友好。
 */
export function readAllEntries(projectRoot: string): Record<string, unknown>[] {
  const ctxPath = getCtxPath(projectRoot);
  
  try {
    const stats = existsSync(ctxPath) ? statSync(ctxPath) : null;
    const currentMtime = stats?.mtimeMs ?? 0;
    const currentSize = stats?.size ?? 0;

    if (cachedEntries && lastPath === ctxPath && lastMtime === currentMtime && lastSize === currentSize) {
      return cachedEntries;
    }

    const entries: Record<string, unknown>[] = [];
    const skippedCountRef = { value: 0 };

    if (existsSync(ctxPath)) {
      const content = readFileSync(ctxPath, "utf-8");
      let start = 0;
      let end = content.indexOf("\n");
      
      while (end !== -1) {
        const line = content.slice(start, end).trim();
        if (line) {
          processLine(line, projectRoot, entries, skippedCountRef);
        }
        start = end + 1;
        end = content.indexOf("\n", start);
      }
      
      const lastLine = content.slice(start).trim();
      if (lastLine) {
        processLine(lastLine, projectRoot, entries, skippedCountRef);
      }
    }

    if (skippedCountRef.value > 0) {
      console.warn(`[ritsu-mcp-server] ⚠️  Skipped ${skippedCountRef.value} malformed/corrupted JSON lines in ctx file.`);
    }

    lastMtime = currentMtime;
    lastSize = currentSize;
    lastPath = ctxPath;
    cachedEntries = entries;
    return entries;
  } catch (e) {
    if (process.env.RITSU_STRICT_JSONL === "1") {
      throw e;
    }
    return [];
  }
}

/** 尾部读取优化：直接从文件末尾扫描最后 N 条记录 */
export function readRecentEntries(
  projectRoot: string,
  limit = 20,
): Record<string, unknown>[] {
  const ctxPath = getCtxPath(projectRoot);
  if (!existsSync(ctxPath)) return [];

  // 如果已经有缓存且是最新的，直接用缓存
  const stats = statSync(ctxPath);
  if (cachedEntries && lastPath === ctxPath && lastMtime === stats.mtimeMs && lastSize === stats.size) {
    return cachedEntries.slice(-limit);
  }

  // 如果文件较小 (< 64KB)，全量读取
  if (stats.size < 65536) {
    return readAllEntries(projectRoot).slice(-limit);
  }

  // 大文件优化：从末尾读取最后 64KB 探测
  const fd = openSync(ctxPath, "r");
  try {
    const readSize = Math.min(stats.size, 65536);
    const buffer = Buffer.alloc(readSize);
    readSync(fd, buffer, 0, readSize, stats.size - readSize);
    
    const content = buffer.toString("utf-8");
    const lines = content.split("\n").filter(l => l.trim());
    const skippedCountRef = { value: 0 };
    const entries: Record<string, unknown>[] = [];

    // process recent lines
    const recentLines = lines.slice(-limit);
    for (const line of recentLines) {
      processLine(line, projectRoot, entries, skippedCountRef);
    }

    if (skippedCountRef.value > 0) {
      console.warn(`[ritsu-mcp-server] ⚠️  Skipped ${skippedCountRef.value} malformed/corrupted JSON lines in recent ctx block.`);
    }

    return entries;
  } catch (e) {
    if (process.env.RITSU_STRICT_JSONL === "1") {
      throw e;
    }
    return readAllEntries(projectRoot).slice(-limit);
  } finally {
    closeSync(fd);
  }
}

export function readLastIncomplete(
  projectRoot: string,
): Record<string, unknown> | null {
  const entries = readAllEntries(projectRoot);
  const doneSet = new Set<string>();

  for (const e of entries) {
    if (e.status === "done" || e.status === "failed") {
      const cid = String(e.correlation_id ?? "");
      if (cid) doneSet.add(cid);
    }
  }

  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.status === "started") {
      const cid = String(e.correlation_id ?? "");
      if (!cid || !doneSet.has(cid)) {
        return e;
      }
    }
  }
  return null;
}

export function readLastCompleted(
  projectRoot: string,
): Record<string, unknown> | null {
  const entries = readAllEntries(projectRoot);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].status === "done") return entries[i];
  }
  return null;
}

/** 获取当日下一个 seq 值（供外部使用） */
export function getNextSeq(projectRoot: string): number {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const prefix = "cid-" + yyyy + mm + dd + "-";

  const entries = readAllEntries(projectRoot);
  let maxSeq = 0;
  for (const e of entries) {
    const cid = String(e.correlation_id ?? "");
    if (cid.startsWith(prefix)) {
      const seqStr = cid.slice(prefix.length);
      const seq = parseInt(seqStr, 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  return maxSeq + 1;
}

/** 重置读取缓存（测试用） */
export function _resetReaderCache(): void {
  cachedEntries = null;
  lastMtime = 0;
  lastSize = 0;
  lastPath = "";
}
