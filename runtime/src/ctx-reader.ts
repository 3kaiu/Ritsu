/**
 * ctx 读取器 — 查询 JSONL 事件记录
 *
 * P1-5 修复：从 ctx-store.ts 拆分，职责聚焦于读取。
 * P1-6 修复：无 WASM 依赖，无循环依赖。
 * P2-1 优化：内存占用优化，避免大文件 split('\n')。
 */

import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { getCtxPath } from "./ctx-path.js";

let cachedEntries: Record<string, unknown>[] | null = null;
let lastMtime: number = 0;
let lastSize: number = 0;
let lastPath: string = "";

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

    if (existsSync(ctxPath)) {
      // 优化：使用流式思想或 Buffer 扫描换行符
      // 这里采用 readFileSync 但手动遍历以减少中间大数组开销
      const content = readFileSync(ctxPath, "utf-8");
      let start = 0;
      let end = content.indexOf("\n");
      
      while (end !== -1) {
        const line = content.slice(start, end).trim();
        if (line) {
          try {
            entries.push(JSON.parse(line));
          } catch {
            // ignore malformed line
          }
        }
        start = end + 1;
        end = content.indexOf("\n", start);
      }
      
      // handle last line without newline
      const lastLine = content.slice(start).trim();
      if (lastLine) {
        try {
          entries.push(JSON.parse(lastLine));
        } catch {}
      }
    }

    lastMtime = currentMtime;
    lastSize = currentSize;
    lastPath = ctxPath;
    cachedEntries = entries;
    return entries;
  } catch (e) {
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
    const recent = lines.slice(-limit).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    return recent;
  } catch (e) {
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
