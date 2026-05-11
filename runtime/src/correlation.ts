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

function todayPrefix(): { dateStr: string; prefix: string } {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}${mm}${dd}`;
  return { dateStr, prefix: `cid-${dateStr}-` };
}

/** 从 ctx 文件内容中扫描当日 max seq（在锁内调用，保证原子性） */
export function scanMaxSeq(ctxPath: string): { dateStr: string; nextSeq: number } {
  const { dateStr, prefix } = todayPrefix();
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

  return { dateStr, nextSeq: maxSeq + 1 };
}

/** 生成 correlation_id 字符串 */
export function formatCorrelationId(dateStr: string, seq: number): string {
  return `cid-${dateStr}-${seq}`;
}
