/**
 * ctx 文件路径管理 — 月度分片路由
 *
 * 职责单一：确定当月 ctx 文件路径、确保 .ritsu 目录存在。
 * 不涉及读写、锁、索引。
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { resolve } from "node:path";
import { reconcileBranchSync } from "./sync.js";

const RITSU_DIR = ".ritsu";

export function getCurrentMonthFilename(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `ctx-${yyyy}-${mm}.jsonl`;
}

export function getCtxPath(projectRoot: string): string {
  return resolve(projectRoot, RITSU_DIR, getCurrentMonthFilename());
}

export function ensureRitsuDir(projectRoot: string): string {
  const dir = resolve(projectRoot, RITSU_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  try {
    reconcileBranchSync(projectRoot);
  } catch {
    // Fail-safe
  }
  return dir;
}

/** 确保 ctx 文件存在（proper-lockfile 要求目标文件存在） */
export function ensureCtxFile(projectRoot: string): string {
  ensureRitsuDir(projectRoot);
  const ctxPath = getCtxPath(projectRoot);
  if (!existsSync(ctxPath)) {
    appendFileSync(ctxPath, "");
  }
  return ctxPath;
}
