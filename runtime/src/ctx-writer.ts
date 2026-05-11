/**
 * ctx 写入器 — 异步锁 + 原子追加 + correlation_id 生成
 *
 * P0-2 修复：使用 proper-lockfile 异步 API，不阻塞事件循环。
 * P0-3 修复：correlation_id 生成和事件追加在同一个锁内完成，消除竞态。
 * P1-5 修复：从 ctx-store.ts 拆分，职责聚焦于写入。
 */

import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { lock, unlock, check as checkLock } from "proper-lockfile";
import { getCtxPath, ensureCtxFile } from "./ctx-path.js";
import { scanMaxSeq, formatCorrelationId } from "./correlation.js";

let _lastLineCount = 0;
let _lastCtxMonth = "";

/** 清理残留锁文件（进程异常退出后可能遗留） */
async function cleanupStaleLock(ctxPath: string): Promise<void> {
  const lockPath = ctxPath + ".lock";
  if (!existsSync(lockPath)) return;

  try {
    const isLocked = await checkLock(ctxPath, { lockfilePath: lockPath });
    if (!isLocked) {
      rmSync(lockPath, { force: true });
    }
  } catch {
    rmSync(lockPath, { force: true });
  }
}

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

  // 月度切换检测
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (currentMonth !== _lastCtxMonth) {
    _lastCtxMonth = currentMonth;
    _lastLineCount = recalcLineCount(ctxPath);
  }

  await cleanupStaleLock(ctxPath);

  const release = await lock(ctxPath);
  try {
    // 在锁内生成 correlation_id（若未提供）
    if (!event.correlation_id) {
      const { dateStr, nextSeq } = scanMaxSeq(ctxPath);
      event.correlation_id = formatCorrelationId(dateStr, nextSeq);
    }

    const line = JSON.stringify(event);
    appendFileSync(ctxPath, line + "\n");
    _lastLineCount++;
  } finally {
    await unlock(ctxPath);
  }

  return {
    path: ctxPath,
    lineCount: _lastLineCount,
    correlation_id: String(event.correlation_id),
  };
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
}

/** 获取 ctx 文件路径（供外部使用） */
export function getCtxFilePath(projectRoot: string): string {
  ensureCtxFile(projectRoot);
  return getCtxPath(projectRoot);
}
