/**
 * ctx 读取器 — 查询 JSONL 事件记录
 *
 * P1-5 修复：从 ctx-store.ts 拆分，职责聚焦于读取。
 * P1-6 修复：无 WASM 依赖，无循环依赖。
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { getCtxPath } from "./ctx-path.js";

let cachedEntries: Record<string, unknown>[] | null = null;
let lastMtime: number = 0;
let lastPath: string = "";

export function readAllEntries(projectRoot: string): Record<string, unknown>[] {
  const ctxPath = getCtxPath(projectRoot);
  
  try {
    const stats = existsSync(ctxPath) ? statSync(ctxPath) : null;
    const currentMtime = stats?.mtimeMs ?? 0;

    if (cachedEntries && lastPath === ctxPath && lastMtime === currentMtime) {
      return cachedEntries;
    }

    const entries: Record<string, unknown>[] = [];

  // JSONL 格式（当前）
  if (existsSync(ctxPath)) {
    const content = readFileSync(ctxPath, "utf-8").trim();
    if (content) {
      for (const line of content.split("\n")) {
        try {
          entries.push(JSON.parse(line) as Record<string, unknown>);
        } catch {
          // 跳过无效行
        }
      }
    }
  }

  // 旧版 .md 格式兼容（pipe-delimited）
  const mdPath = ctxPath.replace(/\.jsonl$/, ".md");
  if (existsSync(mdPath)) {
    const content = readFileSync(mdPath, "utf-8").trim();
    if (content) {
      for (const line of content.split("\n")) {
        if (line.startsWith("#") || line.startsWith("---") || !line.trim())
          continue;
        const parts = line.split("|").map((s) => s.trim());
        if (parts.length >= 5) {
          entries.push({
            ts: parts[0],
            correlation_id: parts[1],
            skill: parts[2],
            domain: parts[3],
            status: parts[4],
            ...(parts[5] ? { step: parts[5] } : {}),
          });
        }
      }
    }
  }

    lastMtime = currentMtime;
    lastPath = ctxPath;
    cachedEntries = entries;
    return entries;
  } catch (e) {
    return [];
  }
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
