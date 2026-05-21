/**
 * Ritsu 原生模块桥接层
 *
 * 使用 Rust napi-rs 原生插件加速向量搜索等计算密集型操作。
 * 回退方案：当原生模块不可用时，使用纯 JS 实现。
 */

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { detectProjectRoot } from "./project-root.js";

type NativeAddon = {
  // Vector store
  initStore(dbPath: string): boolean;
  closeStore(): void;
  indexEmbedding(collection: string, id: string, embedding: number[], metadata?: string): boolean;
  searchSimilar(collection: string, query: number[], topK?: number): SearchResult[];
  removeEmbedding(collection: string, id: string): boolean;
  // Ctx store (Rust-native, replaces bun:sqlite ctx-db)
  initCtxStore(dbPath: string): boolean;
  closeCtxStore(): void;
  ctxInsert(eventJson: string): boolean;
  ctxQueryLastIncomplete(): string | null;
  ctxQueryLastCompleted(): string | null;
  ctxQueryRecent(limit: number): string[];
  ctxQueryAll(limit: number): string[];
  ctxCount(): number;
};

type SearchResult = {
  id: string;
  score: number;
  metadata: string;
};

let _native: NativeAddon | null = null;

function tryLoadNative(): NativeAddon | null {
  if (_native !== null) return _native;
  const possiblePaths = [
    resolve(import.meta.url, "../../native/ritsu-native.darwin-arm64.node"),
    resolve(import.meta.url, "../../native/ritsu-native.darwin-x64.node"),
    resolve(import.meta.url, "../../native/ritsu-native.linux-x64.node"),
    resolve(import.meta.url, "../../native/ritsu-native.win32-x64.node"),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      try {
        _native = require(p) as NativeAddon;
        return _native;
      } catch {
        continue;
      }
    }
  }
  return null;
}

export function isNativeAvailable(): boolean {
  return tryLoadNative() !== null;
}

export function initNativeStore(): boolean {
  const addon = tryLoadNative();
  if (!addon) return false;
  const root = detectProjectRoot();
  const dbPath = resolve(root, ".ritsu", "vectors.db");
  return addon.initStore(dbPath);
}

export function closeNativeStore(): void {
  const addon = tryLoadNative();
  if (addon) addon.closeStore();
}

export function indexViolationEmbedding(
  violationId: string,
  text: string,
  metadata: Record<string, unknown>,
): boolean {
  const addon = tryLoadNative();
  if (!addon) return false;
  const embedding = computeSimpleEmbedding(text);
  return addon.indexEmbedding("violations", violationId, embedding, JSON.stringify(metadata));
}

export function searchSimilarViolations(
  query: string,
  topK: number,
): SearchResult[] {
  const addon = tryLoadNative();
  if (!addon) return [];
  const embedding = computeSimpleEmbedding(query);
  return addon.searchSimilar("violations", embedding, topK);
}

/**
 * 简单嵌入向量计算 — 基于字符 n-gram 的哈希特征。
 * 当无外部 embedding API 时使用。
 * 未来将替换为本地 ONNX 模型或外部 API 调用。
 */
// ─── Ctx Store ──────────────────────────────────────────────

export function initCtxStore(): boolean {
  const addon = tryLoadNative();
  if (!addon) return false;
  const root = detectProjectRoot();
  const dbPath = resolve(root, ".ritsu", "ctx.db");
  return addon.initCtxStore(dbPath);
}

export function ctxInsert(event: Record<string, unknown>): boolean {
  const addon = tryLoadNative();
  if (!addon) return false;
  return addon.ctxInsert(JSON.stringify(event));
}

export function ctxQueryLastIncomplete(): Record<string, unknown> | null {
  const addon = tryLoadNative();
  if (!addon) return null;
  const result = addon.ctxQueryLastIncomplete();
  if (!result) return null;
  try { return JSON.parse(result) as Record<string, unknown>; } catch { return null; }
}

export function ctxQueryLastCompleted(): Record<string, unknown> | null {
  const addon = tryLoadNative();
  if (!addon) return null;
  const result = addon.ctxQueryLastCompleted();
  if (!result) return null;
  try { return JSON.parse(result) as Record<string, unknown>; } catch { return null; }
}

export function ctxQueryRecent(limit = 50): Record<string, unknown>[] {
  const addon = tryLoadNative();
  if (!addon) return [];
  try {
    return addon.ctxQueryRecent(limit).map((s) => JSON.parse(s) as Record<string, unknown>);
  } catch { return []; }
}

export function ctxQueryAll(limit = 10000): Record<string, unknown>[] {
  const addon = tryLoadNative();
  if (!addon) return [];
  try {
    return addon.ctxQueryAll(limit).map((s) => JSON.parse(s) as Record<string, unknown>);
  } catch { return []; }
}

export function closeCtxStore(): void {
  const addon = tryLoadNative();
  if (addon) addon.closeCtxStore();
}

export function computeSimpleEmbedding(text: string, dimensions = 128): number[] {
  const vec = new Array(dimensions).fill(0);
  const normalized = text.toLowerCase().trim();

  // Character bigram hash features
  for (let i = 0; i < normalized.length - 1; i++) {
    const bigram = normalized.slice(i, i + 2);
    let hash = 0;
    for (let j = 0; j < bigram.length; j++) {
      hash = ((hash << 5) - hash + bigram.charCodeAt(j)) | 0;
    }
    const idx = Math.abs(hash) % dimensions;
    vec[idx] += 1;
  }

  // Word-level features
  const words = normalized.split(/\s+/);
  for (const word of words) {
    if (word.length < 2) continue;
    let hash = 0;
    for (let j = 0; j < word.length; j++) {
      hash = ((hash << 5) - hash + word.charCodeAt(j)) | 0;
    }
    const idx = Math.abs(hash) % dimensions;
    vec[idx] += 2; // Word features weighted higher
  }

  // Normalize to unit vector
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < dimensions; i++) {
      vec[i] /= magnitude;
    }
  }

  return vec;
}
