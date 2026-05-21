/**
 * ctx 写入器 — 异步锁 + 原子追加 + correlation_id 生成
 *
 * P0-2 修复：使用 proper-lockfile 异步 API，不阻塞事件循环。
 * P0-3 修复：correlation_id 生成和事件追加在同一个锁内完成，消除竞态。
 * P1-5 修复：从 ctx-store.ts 拆分，职责聚焦于写入。
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { lock } from "proper-lockfile";
import { getCtxPath, ensureCtxFile } from "./ctx-path.js";
import { scanMaxSeq, formatCorrelationId } from "./correlation.js";
import { signEvent, getOrCreateKey } from "./policy/signature.js";
import { getProjectRoot } from "./handlers/_utils.js";

let _ctxDb: typeof import("./ctx-db.js") | null = null;

function tryInitSqlite(): boolean {
  if (_ctxDb) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./ctx-db.js") as typeof import("./ctx-db.js");
    if (mod.openDb(getProjectRoot())) {
      _ctxDb = mod;
      return true;
    }
  } catch { /* bun:sqlite unavailable */ }
  return false;
}

let _lastLineCount = 0;
let _lastCtxMonth = "";
let _lastCtxPath = "";


/** 重算行数（月度切换或索引重建时调用） */
function recalcLineCount(ctxPath: string): number {
  if (!existsSync(ctxPath)) return 0;
  const content = readFileSync(ctxPath, "utf-8").trim();
  return content ? content.split("\n").length : 0;
}

export interface AppendResult {
  path: string;
  lineCount: number;
  correlation_id: string;
}

/**
 * 原子追加事件 — 在单个异步锁内完成 correlation_id 生成 + 事件写入
 *
 * 调用方若已提供 correlation_id 则直接使用；
 * 否则在锁内扫描当日 max seq 并生成新 ID，保证原子性。
 */
export async function appendEvent(
  projectRoot: string,
  event: Record<string, unknown>,
): Promise<AppendResult> {
  const ctxPath = ensureCtxFile(projectRoot);

  // 月度切换或路径切换检测
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (currentMonth !== _lastCtxMonth || ctxPath !== _lastCtxPath) {
    _lastCtxMonth = currentMonth;
    _lastCtxPath = ctxPath;
    _lastLineCount = recalcLineCount(ctxPath);
  }


  const release = await lock(ctxPath, {
    retries: {
      retries: 5,
      factor: 2,
      minTimeout: 100,
      maxTimeout: 1000,
      randomize: true,
    }
  });
  try {
    // 在锁内生成 correlation_id（若未提供且没有 trace_id）
    if (!event.correlation_id && !event.trace_id) {
      const { dateStr, nextSeq } = scanMaxSeq(ctxPath);
      event.correlation_id = formatCorrelationId(dateStr, nextSeq);
    }

    // Trace Signing (Batch 8.2)
    const key = getOrCreateKey();
    if (key) {
      event.signature = signEvent(event, key);
    }

    const line = JSON.stringify(event);
    appendFileSync(ctxPath, line + "\n");
    _lastLineCount++;

    // Dual-write to SQLite when available
    if (tryInitSqlite() && _ctxDb) {
      _ctxDb.insertEvent(event);
    }
  } finally {
    await release(); // proper-lockfile suggests using the release function returned by lock()
  }

  return {
    path: ctxPath,
    lineCount: _lastLineCount,
    correlation_id: String(event.correlation_id ?? event.trace_id ?? ""),
  };
}

/** 重置计数器（测试用） */
export function _resetWriterCache(): void {
  _lastLineCount = 0;
  _lastCtxMonth = "";
  _lastCtxPath = "";
}

/** 重置行数计数器（索引重建时调用） */
export function resetLineCount(count: number): void {
  _lastLineCount = count;
}

/** 从 ctx 文件重算真实行数，修正 JS 计数器漂移 */
export function syncLineCountFromCtxFile(projectRoot: string): void {
  const ctxPath = getCtxPath(projectRoot);
  _lastLineCount = recalcLineCount(ctxPath);
  _lastCtxMonth = new Date().toISOString().slice(0, 7);
  _lastCtxPath = ctxPath;
}

/** 获取 ctx 文件路径（供外部使用） */
export function getCtxFilePath(projectRoot: string): string {
  ensureCtxFile(projectRoot);
  return getCtxPath(projectRoot);
}
