/**
 * correlation_id 生成器
 *
 * 格式: cid-{YYYYMMDD}-{seq}
 * seq 为当日递增序号。
 *
 * 所有操作在调用方持有的锁内执行，保证原子性。
 * 不自行加锁 — 锁的生命周期由 ctx-writer 管理。
 */

import { existsSync, readFileSync } from "node:fs";
import { getCtxPath } from "./ctx-path.js";

function todayPrefix(): { dateStr: string; prefix: string } {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}${mm}${dd}`;
  return { dateStr, prefix: `cid-${dateStr}-` };
}

export function legacyCidToTraceId(cid: string): string {
  if (cid.startsWith("trace-")) return cid;
  // cid format: cid-YYYYMMDD-seq (e.g. cid-20260515-001)
  const match = cid.match(/^cid-(\d{8})-(.+)$/);
  if (!match) return `trace-19700101-0000000000000000`;
  const dateStr = match[1];
  const seqStr = match[2];
  // pad to 16 hex
  const hex = seqStr.padStart(16, "0");
  return `trace-${dateStr}-${hex}`;
}

export function legacyCidToSpanId(cid: string): string {
  if (cid.startsWith("span-")) return cid;
  const match = cid.match(/^cid-\d{8}-(.+)$/);
  if (!match) return `span-00000000`;
  const seqStr = match[1];
  // pad to 8 hex
  const hex = seqStr.padStart(8, "0");
  return `span-${hex}`;
}

let _seqCache: { dateStr: string; maxSeq: number } | null = null;

/** 从 ctx 文件内容中扫描当日 max seq（在锁内调用，保证原子性） */
export function scanMaxSeq(ctxPath: string): { dateStr: string; nextSeq: number } {
  const { dateStr, prefix } = todayPrefix();

  // 命中缓存: 直接递增
  if (_seqCache && _seqCache.dateStr === dateStr) {
    _seqCache.maxSeq++;
    return { dateStr, nextSeq: _seqCache.maxSeq };
  }

  let maxSeq = 0;

  if (existsSync(ctxPath)) {
    const content = readFileSync(ctxPath, "utf-8").trim();
    if (content) {
      for (const line of content.split("\n")) {
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          const cid = String(obj.correlation_id ?? "");
          if (cid.startsWith(prefix)) {
            const seq = parseInt(cid.slice(prefix.length), 10);
            if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
          }
        } catch {
          // 跳过无效行
        }
      }
    }
  }

  const nextSeq = maxSeq + 1;
  _seqCache = { dateStr, maxSeq: nextSeq };
  return { dateStr, nextSeq };
}

/** 重置 ID 缓存（测试用） */
export function _resetCorrelationCache(): void {
  _seqCache = null;
}

/** 生成 correlation_id 字符串 */
export function formatCorrelationId(dateStr: string, seq: number): string {
  return `cid-${dateStr}-${seq}`;
}

/** 完整生成流程：扫描 -> 计算 -> 格式化 */
export function generateCorrelationId(projectRoot: string): string {
  const ctxPath = getCtxPath(projectRoot);
  const scanResult = scanMaxSeq(ctxPath);
  const dateStr = scanResult.dateStr;
  let nextSeq = scanResult.nextSeq;
  
  if (existsSync(ctxPath)) {
    try {
      const content = readFileSync(ctxPath, "utf-8");
      let cid = formatCorrelationId(dateStr, nextSeq);
      while (content.includes(`"correlation_id":"${cid}"`)) {
        console.warn(`[ritsu-mcp-server] ⚠️  Collision detected for CID '${cid}'. Auto-incrementing sequence.`);
        nextSeq++;
        cid = formatCorrelationId(dateStr, nextSeq);
      }
      if (_seqCache && _seqCache.dateStr === dateStr) {
        _seqCache.maxSeq = nextSeq;
      }
      return cid;
    } catch {
      // fallback
    }
  }

  return formatCorrelationId(dateStr, nextSeq);
}
