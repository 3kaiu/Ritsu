/**
 * ctx 文件工具 — 读写 .ritsu/ctx-{YYYY-MM}.jsonl
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";
import { lockSync, unlockSync, checkSync } from "proper-lockfile";

const RITSU_DIR = ".ritsu";

function getCurrentMonthFilename(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `ctx-${yyyy}-${mm}.jsonl`;
}

function getCtxPath(projectRoot: string): string {
  return resolve(projectRoot, RITSU_DIR, getCurrentMonthFilename());
}

function ensureRitsuDir(projectRoot: string): string {
  const dir = resolve(projectRoot, RITSU_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

let _lastLineCount = 0;
let _lastCtxMonth = "";

/** 清理残留锁文件（进程异常退出后可能遗留） */
function cleanupStaleLock(ctxPath: string): void {
  const lockPath = ctxPath + ".lock";
  if (existsSync(lockPath)) {
    try {
      // 检查锁是否 stale（无进程持有）
      if (!checkSync(ctxPath, { lockfilePath: ctxPath + ".lock" })) {
        rmSync(lockPath, { force: true });
      }
    } catch {
      // checkSync 在锁文件损坏时抛异常，直接清理
      rmSync(lockPath, { force: true });
    }
  }
}

export function appendEvent(
  projectRoot: string,
  event: Record<string, unknown>,
): { path: string; lineCount: number } {
  ensureRitsuDir(projectRoot);
  const ctxPath = getCtxPath(projectRoot);
  const line = JSON.stringify(event);

  // 月度切换检测 — 新月份重置行数计数器
  const currentMonth = getCurrentMonthFilename();
  if (currentMonth !== _lastCtxMonth) {
    _lastCtxMonth = currentMonth;
    // 重新统计新文件行数
    if (existsSync(ctxPath)) {
      const content = readFileSync(ctxPath, "utf-8").trim();
      _lastLineCount = content ? content.split("\n").length : 0;
    } else {
      _lastLineCount = 0;
    }
  }

  // 清理残留锁
  cleanupStaleLock(ctxPath);

  // 确保 ctx 文件存在（proper-lockfile 要求目标文件存在）
  if (!existsSync(ctxPath)) {
    appendFileSync(ctxPath, "");
  }

  // 原子追加锁 — 锁定 ctx 文件本身，粒度精确
  lockSync(ctxPath);
  try {
    appendFileSync(ctxPath, line + "\n");
    _lastLineCount++;
  } finally {
    unlockSync(ctxPath);
  }

  return { path: ctxPath, lineCount: _lastLineCount };
}

/** 重置行数计数器（索引重建时调用） */
export function resetLineCount(count: number): void {
  _lastLineCount = count;
}

/** 从 ctx 文件重算真实行数，修正 JS 计数器漂移 */
export function syncLineCountFromCtxFile(projectRoot: string): void {
  const ctxPath = getCtxPath(projectRoot);
  if (!existsSync(ctxPath)) {
    _lastLineCount = 0;
    return;
  }
  const content = readFileSync(ctxPath, "utf-8").trim();
  _lastLineCount = content ? content.split("\n").length : 0;
  _lastCtxMonth = getCurrentMonthFilename();
}

/** 获取 ctx 文件路径（供外部构建 WASM 索引） */
export function getCtxFilePath(projectRoot: string): string {
  ensureRitsuDir(projectRoot);
  return getCtxPath(projectRoot);
}

export function readAllEntries(projectRoot: string): Record<string, unknown>[] {
  const ctxPath = getCtxPath(projectRoot);
  if (!existsSync(ctxPath)) return [];

  const content = readFileSync(ctxPath, "utf-8").trim();
  if (!content) return [];

  return content
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((e): e is Record<string, unknown> => e !== null);
}

export function readRecentEntries(
  projectRoot: string,
  limit = 20,
): Record<string, unknown>[] {
  const all = readAllEntries(projectRoot);
  return all.slice(-limit);
}

export function readLastIncomplete(
  projectRoot: string,
): Record<string, unknown> | null {
  const entries = readAllEntries(projectRoot);
  const doneSet = new Set<string>();

  // 先收集所有 done/failed 的 correlation_id
  for (const e of entries) {
    if (e.status === "done" || e.status === "failed") {
      const cid = String(e.correlation_id ?? "");
      if (cid) doneSet.add(cid);
    }
  }

  // 从后往前找 started 且未完成的
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

export function getNextSeq(projectRoot: string): number {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const prefix = `cid-${yyyy}${mm}${dd}-`;

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

export function generateCorrelationId(projectRoot: string): string {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const seq = getNextSeq(projectRoot);
  return `cid-${yyyy}${mm}${dd}-${seq}`;
}
