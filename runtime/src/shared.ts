/**
 * 共享路径工具 & 常量 — 单一事实来源
 *
 * 消除 schema-compiler / event-validator / wasm-bridge 三处重复的 getSharedDir()。
 * 消除 handlers 中 validTypes / prefixMap 双重重复。
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getSharedDir(): string {
  return process.env.RITSU_SHARED_DIR ?? resolve(__dirname, "../../_shared");
}

export function getPkgDir(): string {
  return process.env.RITSU_PKG_DIR ?? resolve(__dirname, "../pkg");
}

// ─── Artifact 常量 ──────────────────────────────────────────

export const ARTIFACT_VALID_TYPES = [
  "handoff",
  "diagnosis",
  "review-stamp",
  "optimize-report",
] as const;

export type ArtifactType = (typeof ARTIFACT_VALID_TYPES)[number];

/** 产物类型 → 文件名前缀映射（含 ctx 用于 list 查询） */
export const ARTIFACT_PREFIX_MAP: Record<string, string> = {
  handoff: "handoff-",
  diagnosis: "diagnosis-",
  "review-stamp": "review-stamp-",
  "optimize-report": "optimize-report-",
  ctx: "ctx-",
};

// ─── ritsu_exec 安全边界常量 ────────────────────────────────

export const ALLOWED_BINARIES = new Set([
  "git",
  "grep",
  "rg",
  "cat",
  "head",
  "tail",
  "ls",
  "find",
  "fd",
  "wc",
  "sort",
  "uniq",
  "diff",
  "echo",
  "pwd",
  "which",
  "env",
  "node",
  "npx",
  "npm",
  "nvm",
  "yarn",
  "pnpm",
  "tsc",
  "eslint",
  "prettier",
  "vitest",
  "jest",
  "cargo",
  "rustc",
  "rustup",
  "jq",
  "yq",
  "make",
  "cmake",
  "task",
  "dotnet",
  "sed",
  "awk",
  "tr",
  "cut",
  "xargs",
  "tee",
  "mkdir",
  "touch",
  "cp",
  "mv",
  "ln",
  "curl",
  "wget",
  "python3",
  "python",
  "docker",
  "kubectl",
  "gh",
]);

export const RESIDUAL_BLACKLIST: RegExp[] = [
  /\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*\b/,
  /\bgit\s+push\s+.*--(force|no-verify|force-with-lease)\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\b(npm|yarn|pnpm)\s+(i\b|install\b|publish|unpublish|access)\b/,
  /\b(npm|yarn|pnpm)\s+config\s+set\s+.*registry\b/,
  /\bchmod\s+(777|000|u\+s)\b/,
  /\bchown\s+.*\broot\b/,
  /\bdocker\s+(rm|rmi|system\s+prune)\b/,
  /\bkubectl\s+delete\b/,
  /\bshutdown\b|\breboot\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
];
