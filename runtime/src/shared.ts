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

// Shell 元字符拦截 — ritsu_exec 只支持单命令直接执行，拒绝所有 shell 特性
export const SHELL_META_REJECT: RegExp[] = [
  /\$\(/, // Command substitution $(...)
  /`/, // Backtick substitution
  /\n/, // Newline (multi-command injection)
  /\r/, // Carriage return
  /\|/, // Pipe
  /&&/, // AND operator
  /\|\|/, // OR operator
  /;/, // Command separator
  />>?/, // Output redirect
  /<</, // Here-doc
  /<(?!\w)/, // Input redirect (but allow < in args like -e "x < y")
  /\(\)/, // Subshell
];

// 危险参数黑名单 — 拦截白名单二进制的代码注入/数据外泄用法
export const DANGEROUS_ARGS: RegExp[] = [
  /\bnode\s+(-e|--eval|\s+-i|--interactive)\b/, // node -e "任意代码"
  /\bpython3?\s+(-c|--command)\b/, // python3 -c "任意代码"
  /\bdocker\s+(exec|run)\b/, // docker exec/rm 可在容器内执行任意命令
  /\bcurl\s+[^&]*-d\s+@/, // curl -d @/etc/shadow 数据外泄
  /\bcurl\s+[^&]*--data-binary\s+@/, // curl --data-binary @文件
  /\bwget\s+[^&]*--post-file\s+/, // wget --post-file 数据外泄
  /\bgit\s+checkout\s+--\s+\.\s*$/, // git checkout -- . 丢弃所有工作区变更
];

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

// ritsu_exec 参数硬上限
export const MAX_BUFFER_MB_HARD_LIMIT = 100;
export const MAX_TIMEOUT_MS_HARD_LIMIT = 120_000;
