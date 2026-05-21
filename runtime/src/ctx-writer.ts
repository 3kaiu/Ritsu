/**
 * ctx 写入器 — Rust WAL 并发 + JSONL 备份
 *
 * 主写入路径走 Rust native ctx store (SQLite WAL 模式, 线程安全)。
 * JSONL 保留为备份写入，用于数据可移植性。
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { getCtxPath, ensureCtxFile } from "./ctx-path.js";
import { scanMaxSeq, formatCorrelationId } from "./correlation.js";
import { signEvent, getOrCreateKey } from "./policy/signature.js";

let _nativeCtxReady = false;

function tryInitNativeCtx(): boolean {
  if (_nativeCtxReady) return true;
  try {
    const nb = require("./native-bridge.js") as typeof import("./native-bridge.js");
    if (nb.initCtxStore()) {
      _nativeCtxReady = true;
      return true;
    }
  } catch { /* native module unavailable */ }
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
 * 追加事件: Rust WAL 模式处理并发，JSONL 为可移植性备份。
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

  // 生成 correlation_id
  if (!event.correlation_id && !event.trace_id) {
    const { dateStr, nextSeq } = scanMaxSeq(ctxPath);
    event.correlation_id = formatCorrelationId(dateStr, nextSeq);
  }

  // Trace Signing
  const key = getOrCreateKey();
  if (key) {
    event.signature = signEvent(event, key);
  }

  // 主写入: Rust native ctx store (SQLite WAL, 线程安全)
  if (tryInitNativeCtx()) {
    try {
      const nb = require("./native-bridge.js") as typeof import("./native-bridge.js");
      nb.ctxInsert(event);
    } catch { /* ignore — JSONL backup follows */ }
  }

  // 备份写入: JSONL (可移植性)
  const line = JSON.stringify(event);
  appendFileSync(ctxPath, line + "\n");
  _lastLineCount++;

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
