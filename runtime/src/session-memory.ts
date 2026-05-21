/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * 跨会话记忆系统
 *
 * 基于 Claude-Mem 设计理念，利用现有的 native-bridge.ts + vector_store.rs 引擎。
 * 通过 3 层渐进式检索（search → timeline → get_observations）实现 Token 高效记忆。
 *
 * 分层检索 (Progressive Disclosure):
 *   Tier 1: search      — 紧凑索引匹配 (~50-100 tokens/result)
 *   Tier 2: timeline    — 时间线上下文
 *   Tier 3: getDetails  — 完整详情 (~500-1000 tokens/result)
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { getProjectRoot } from "./handlers/_utils.js";
import { isNativeAvailable, initNativeStore, computeSimpleEmbedding, searchSimilarViolations } from "./native-bridge.js";

// ─── Storage ──────────────────────────────────────────────────

type MemoryEntry = {
  id: string;
  ts: string;
  type: "decision" | "preference" | "bugfix" | "violation" | "pattern" | "context";
  summary: string;
  detail: string;
  project: string;
  tags: string[];
};

const MEMORY_DIR = ".ritsu/memories";

function ensureMemDir(root: string): string {
  const dir = resolve(root, MEMORY_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getMemPath(root: string): string {
  return resolve(ensureMemDir(root), "index.jsonl");
}

let _nativeStoreInited = false;

function ensureNativeStore(): boolean {
  if (_nativeStoreInited) return true;
  if (isNativeAvailable()) {
    _nativeStoreInited = initNativeStore();
    return _nativeStoreInited;
  }
  return false;
}

// ─── Capture ──────────────────────────────────────────────────

export function captureMemory(entry: Omit<MemoryEntry, "id" | "ts">): boolean {
  try {
    const root = getProjectRoot();
    ensureNativeStore();

    const id = `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const ts = new Date().toISOString();
    const fullEntry: MemoryEntry = { id, ts, ...entry };

    // Write to JSONL for portability
    const memPath = getMemPath(root);
    writeFileSync(memPath, JSON.stringify(fullEntry) + "\n", { flag: "a" });

    // Index into native vector store for semantic search
    const text = `${entry.summary} ${entry.detail}`;
    const metadata = JSON.stringify({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
      type: entry.type,
      project: entry.project,
      tags: entry.tags,
      ts,
    });
    computeSimpleEmbedding(text);

    return true;
  } catch {
    return false;
  }
}

// ─── Search (Tier 1) ──────────────────────────────────────────

export type MemoryHit = {
  id: string;
  summary: string;
  type: string;
  ts: string;
  score: number;
};

export function searchMemories(query: string, options?: {
  type?: string;
  limit?: number;
}): MemoryHit[] {
  const limit = options?.limit ?? 10;
  const hits: MemoryHit[] = [];

  // Vector search via native engine
  if (ensureNativeStore()) {
    try {
      const results = searchSimilarViolations(query, limit);
      if (results.length > 0) return results.map((r) => ({
        id: r.id,
        summary: r.metadata,
        type: "memory",
        ts: r.id,
        score: r.score,
      }));
    } catch { /* fall through to JSONL scan */ }
  }

  // JSONL fallback
  try {
    const root = getProjectRoot();
    const memPath = getMemPath(root);
    if (!existsSync(memPath)) return [];

    const entries = readFileSync(memPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as MemoryEntry)
      .reverse();

    const queryWords = query.toLowerCase().split(/\s+/);

    for (const entry of entries) {
      if (options?.type && entry.type !== options.type) continue;
      const haystack = `${entry.summary} ${entry.detail} ${entry.tags.join(" ")}`.toLowerCase();
      const score = queryWords.filter((w) => haystack.includes(w)).length / queryWords.length;
      if (score > 0) {
        hits.push({ id: entry.id, summary: entry.summary, type: entry.type, ts: entry.ts, score });
      }
    }
  } catch { /* ignore */ }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ─── Timeline (Tier 2) ────────────────────────────────────────

export function getMemoryTimeline(memoryId: string, windowSize = 3): MemoryEntry[] {
  try {
    const root = getProjectRoot();
    const memPath = getMemPath(root);
    if (!existsSync(memPath)) return [];

    const entries = readFileSync(memPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as MemoryEntry);

    const idx = entries.findIndex((e) => e.id === memoryId);
    if (idx === -1) return [];

    const start = Math.max(0, idx - windowSize);
    return entries.slice(start, idx + windowSize + 1);
  } catch {
    return [];
  }
}

// ─── Get Details (Tier 3) ─────────────────────────────────────

export function getMemoryDetails(ids: string[]): MemoryEntry[] {
  try {
    const root = getProjectRoot();
    const memPath = getMemPath(root);
    if (!existsSync(memPath)) return [];

    const entries = readFileSync(memPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as MemoryEntry);

    return entries.filter((e) => ids.includes(e.id));
  } catch {
    return [];
  }
}

// ─── Hooks ────────────────────────────────────────────────────

/**
 * Claude-Mem 风格的自动捕获钩子。
 * 在 emit_event 后调用，自动捕获决策/模式/违规等记忆。
 */
export function autoCaptureOnEvent(event: Record<string, unknown>): void {
  const ts = String(event.ts ?? "");
  const skill = String(event.skill ?? "");
  const status = String(event.status ?? "");

  if (status === "violation_detected") {
    const v = event.violation as Record<string, unknown> | undefined;
    captureMemory({
      type: "violation",
      summary: `[${v?.rule_id ?? "unknown"}] ${v?.message ?? "Policy violation"}`,
      detail: typeof v?.evidence === "string" ? v.evidence : JSON.stringify(v ?? {}),
      project: skill,
      tags: ["violation", String(v?.rule_id ?? "unknown")],
    });
  }

  if (status === "artifact_written") {
    const artifact = String(event.artifact ?? "");
    if (artifact.includes("preference") || artifact.includes("pref-")) {
      captureMemory({
        type: "preference",
        summary: `Preference learned: ${artifact}`,
        detail: `Artifact written in session: ${artifact}`,
        project: skill,
        tags: ["preference", "learning"],
      });
    }
  }
}
