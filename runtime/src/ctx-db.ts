/**
 * SQLite ctx 存储 — 替代 JSONL 平面文件方案
 *
 * 使用 bun:sqlite 实现 O(1) 查询、索引加速。
 * JSONL 文件保留作为写入基线和回退方案。
 */

import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getCtxPath } from "./ctx-path.js";
import { detectProjectRoot } from "./project-root.js";

type SQLiteDB = {
  run: (sql: string, params?: Record<string, unknown>) => void;
  query: (sql: string, params?: Record<string, unknown>) => { all: () => Record<string, unknown>[] };
  close: () => void;
};

let _db: SQLiteDB | null = null;

function getDbPath(root: string): string {
  return resolve(root, ".ritsu", "ctx.db");
}

export function openDb(root: string): boolean {
  try {
    const { Database } = require("bun:sqlite") as {
      Database: new (path: string, opts?: { create: boolean }) => SQLiteDB;
    };
    const dbPath = getDbPath(root);
    _db = new Database(dbPath, { create: true });
    _db.run("PRAGMA journal_mode = WAL");
    _db.run("PRAGMA synchronous = NORMAL");
    initSchema();
    return true;
  } catch {
    _db = null;
    return false;
  }
}

function initSchema(): void {
  if (!_db) return;
  _db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      ts_ms INTEGER,
      correlation_id TEXT,
      trace_id TEXT,
      span_id TEXT,
      parent_span_id TEXT,
      span_kind TEXT,
      skill TEXT,
      domain TEXT,
      status TEXT NOT NULL,
      step TEXT,
      artifact TEXT,
      artifact_meta TEXT,
      error TEXT,
      cost TEXT,
      violation TEXT,
      agent TEXT,
      metadata TEXT,
      name TEXT,
      signature TEXT,
      data TEXT
    )
  `);
  _db.run("CREATE INDEX IF NOT EXISTS idx_events_status ON events(status)");
  _db.run("CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)");
  _db.run("CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events(correlation_id)");
  _db.run("CREATE INDEX IF NOT EXISTS idx_events_trace_id ON events(trace_id)");
  _db.run("CREATE INDEX IF NOT EXISTS idx_events_skill ON events(skill)");
  _db.run("CREATE INDEX IF NOT EXISTS idx_events_artifact ON events(artifact)");
}

export function insertEvent(event: Record<string, unknown>): boolean {
  if (!_db) return false;
  try {
    _db.run(
      `INSERT INTO events (ts, ts_ms, correlation_id, trace_id, span_id, parent_span_id,
        span_kind, skill, domain, status, step, artifact, artifact_meta, error,
        cost, violation, agent, metadata, name, signature, data)
      VALUES ($ts, $ts_ms, $correlation_id, $trace_id, $span_id, $parent_span_id,
        $span_kind, $skill, $domain, $status, $step, $artifact, $artifact_meta, $error,
        $cost, $violation, $agent, $metadata, $name, $signature, $data)`,
      {
        $ts: String(event.ts ?? ""),
        $ts_ms: typeof event.ts_ms === "number" ? event.ts_ms : null,
        $correlation_id: event.correlation_id ?? null,
        $trace_id: event.trace_id ?? null,
        $span_id: event.span_id ?? null,
        $parent_span_id: event.parent_span_id ?? null,
        $span_kind: event.span_kind ?? null,
        $skill: event.skill ?? null,
        $domain: event.domain ?? null,
        $status: String(event.status ?? "unknown"),
        $step: event.step ?? null,
        $artifact: event.artifact ?? null,
        $artifact_meta: event.artifact_meta ? JSON.stringify(event.artifact_meta) : null,
        $error: event.error ?? null,
        $cost: event.cost ? JSON.stringify(event.cost) : null,
        $violation: event.violation ? JSON.stringify(event.violation) : null,
        $agent: event.agent ? JSON.stringify(event.agent) : null,
        $metadata: event.metadata ? JSON.stringify(event.metadata) : null,
        $name: event.name ?? null,
        $signature: event.signature ?? null,
        $data: JSON.stringify(event),
      } as Record<string, unknown>,
    );
    return true;
  } catch {
    return false;
  }
}

function queryData(sql: string, params?: Record<string, unknown>): Record<string, unknown>[] {
  if (!_db) return [];
  try {
    const rows = _db.query(sql, params).all();
    return rows.map((row) => {
      const data = (row as Record<string, unknown>).data;
      return typeof data === "string" ? JSON.parse(data) as Record<string, unknown> : {};
    });
  } catch {
    return [];
  }
}

export function queryEvents(options: {
  status?: string;
  skill?: string;
  traceId?: string;
  correlationId?: string;
  limit?: number;
  offset?: number;
  since?: string;
}): Record<string, unknown>[] {
  if (!_db) return [];

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (options.status) { conditions.push("status = $status"); params.$status = options.status; }
  if (options.skill) { conditions.push("skill = $skill"); params.$skill = options.skill; }
  if (options.traceId) { conditions.push("trace_id = $traceId"); params.$traceId = options.traceId; }
  if (options.correlationId) { conditions.push("correlation_id = $correlationId"); params.$correlationId = options.correlationId; }
  if (options.since) { conditions.push("ts >= $since"); params.$since = options.since; }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;

  return queryData(
    `SELECT data FROM events ${where} ORDER BY id DESC LIMIT $limit OFFSET $offset`,
    { ...params, $limit: limit, $offset: offset },
  );
}

export function queryLastIncomplete(): Record<string, unknown> | null {
  const rows = queryData("SELECT data FROM events WHERE status = 'started' ORDER BY id DESC LIMIT 1");
  return rows.length > 0 ? rows[0] : null;
}

export function queryLastCompleted(): Record<string, unknown> | null {
  const rows = queryData("SELECT data FROM events WHERE status IN ('done', 'failed') ORDER BY id DESC LIMIT 1");
  return rows.length > 0 ? rows[0] : null;
}

export function queryRecentEntries(limit = 50): Record<string, unknown>[] {
  return queryData("SELECT data FROM events ORDER BY id DESC LIMIT ?", { "?: number": limit } as Record<string, unknown>);
}

export function countEvents(): number {
  if (!_db) return 0;
  try {
    const rows = _db.query("SELECT COUNT(*) as count FROM events").all() as Record<string, unknown>[];
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

export function isDbOpen(): boolean {
  return _db !== null;
}

export function closeDb(): void {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
    _db = null;
  }
}

export function migrateFromJsonl(root: string): { migrated: number } {
  const ctxPath = getCtxPath(root);
  if (!existsSync(ctxPath)) return { migrated: 0 };
  if (!_db) {
    const opened = openDb(root);
    if (!opened) return { migrated: 0 };
  }

  const content = readFileSync(ctxPath, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  let migrated = 0;

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (insertEvent(event)) migrated++;
    } catch { /* skip malformed lines */ }
  }

  return { migrated };
}
