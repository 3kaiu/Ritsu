/**
 * ctx 文件工具 — 读写 .ritsu/ctx-{YYYY-MM}.jsonl
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";

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

export function appendEvent(
  projectRoot: string,
  event: Record<string, unknown>
): { path: string; lineCount: number } {
  ensureRitsuDir(projectRoot);
  const ctxPath = getCtxPath(projectRoot);
  const line = JSON.stringify(event);
  appendFileSync(ctxPath, line + "\n");

  // 统计行数
  const content = readFileSync(ctxPath, "utf-8");
  const lineCount = content.trim().split("\n").length;
  return { path: ctxPath, lineCount };
}

export function readRecentEntries(
  projectRoot: string,
  limit = 20
): Record<string, unknown>[] {
  const ctxPath = getCtxPath(projectRoot);
  if (!existsSync(ctxPath)) return [];

  const content = readFileSync(ctxPath, "utf-8").trim();
  if (!content) return [];

  const lines = content.split("\n");
  const recent = lines.slice(-limit);

  return recent
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((e): e is Record<string, unknown> => e !== null);
}

export function readLastIncomplete(
  projectRoot: string
): Record<string, unknown> | null {
  const entries = readRecentEntries(projectRoot, 50);
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
  projectRoot: string
): Record<string, unknown> | null {
  const entries = readRecentEntries(projectRoot, 50);
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

  const entries = readRecentEntries(projectRoot, 200);
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

export function getCtxFileSize(projectRoot: string): number {
  const ctxPath = getCtxPath(projectRoot);
  if (!existsSync(ctxPath)) return 0;
  return statSync(ctxPath).size;
}
