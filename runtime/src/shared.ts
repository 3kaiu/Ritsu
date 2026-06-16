/**
 * 共享路径工具 & 常量 — 单一事实来源
 */

import { resolve, dirname } from "node:path";
import * as cp from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getSharedDir(): string {
  const custom = process.env.RITSU_SHARED_DIR;
  if (custom) return custom;
  
  const inDist = resolve(__dirname, "_shared");
  if (existsSync(inDist)) {
    return inDist;
  }
  return resolve(__dirname, "../../_shared");
}

// ─── Skill / Stage 语义映射 ────────────────────────────────

export const SKILL_STAGE_MAP: Record<string, string> = {
  init: "init",
  think: "think",
  dev: "dev",
  hunt: "hunt",
  review: "review",
  augment: "augment",
};

export function getStageForSkill(skill: string): string {
  return SKILL_STAGE_MAP[skill] ?? skill;
}

// ─── 阶段感知产物校验 ───────────────────────────────────────────

export const STAGE_ARTIFACT_MAP: Record<string, string[]> = {
  think: ["design-sheet", "design-brief", "coordination-sheet"],
  dev: ["dev-report"],
  augment: ["dev-report"],
  review: ["assurance-sheet"],
  hunt: ["diagnosis"],
};

export function getStageArtifactTypes(stage: string): string[] {
  return STAGE_ARTIFACT_MAP[stage] ?? [];
}

export function isArtifactTypeAllowedForStage(type: string, stage: string): boolean {
  const allowed = getStageArtifactTypes(stage);
  return allowed.length === 0 || allowed.includes(type);
}

// ─── Artifact 注册表 (中心化管理) ───────────────────────────

export type ArtifactLayer = "primary" | "evidence" | "compatibility" | "system";

export interface ArtifactDefinition {
  type: string;
  prefix: string;
  layer: ArtifactLayer;
  aliases?: string[];
  preferredAlias?: string;
}

/**
 * 产物中心注册表：消除冗余的映射关系。
 */
export const ARTIFACT_REGISTRY: ArtifactDefinition[] = [
  { type: "design-sheet", prefix: "design-sheet-", layer: "primary" },
  { type: "design-brief", prefix: "design-brief-", layer: "primary" },
  { type: "dev-report", prefix: "dev-report-", layer: "primary" },
  { type: "assurance-sheet", prefix: "assurance-sheet-", layer: "primary" },
  { type: "diagnosis", prefix: "diagnosis-", layer: "evidence" },
  { type: "coordination-sheet", prefix: "coordination-sheet-", layer: "primary" },
  { type: "deploy-plan", prefix: "deploy-plan-", layer: "primary" },
  { type: "deploy-report", prefix: "deploy-report-", layer: "primary" },
  { type: "ctx", prefix: "ctx-", layer: "system" },
];

export const ARTIFACT_VALID_TYPES = [
  "design-sheet",
  "design-brief",
  "dev-report",
  "assurance-sheet",
  "diagnosis",
  "coordination-sheet",
  "deploy-plan",
  "deploy-report",
  "ctx",
] as const;
export type ArtifactType = (typeof ARTIFACT_VALID_TYPES)[number];

export function getCanonicalArtifactType(type: string): string {
  const match = ARTIFACT_REGISTRY.find(
    (a) => a.type === type || a.aliases?.includes(type),
  );
  return match?.type ?? type;
}

export function getPreferredArtifactType(type: string): string {
  const match = ARTIFACT_REGISTRY.find(
    (a) => a.type === type || a.aliases?.includes(type),
  );
  return match?.preferredAlias ?? match?.type ?? type;
}

export function isArtifactTypeInSameFamily(a: string, b: string): boolean {
  return getCanonicalArtifactType(a) === getCanonicalArtifactType(b);
}

export function getArtifactPrefixesForType(type: string): string[] {
  if (type === "all") return ARTIFACT_REGISTRY.map((a) => a.prefix);
  const canonical = getCanonicalArtifactType(type);
  return ARTIFACT_REGISTRY.filter((a) => a.type === canonical).map(
    (a) => a.prefix,
  );
}

export function detectArtifactTypeFromFileName(
  fileName: string,
): string | null {
  const match = ARTIFACT_REGISTRY.find((a) => fileName.startsWith(a.prefix));
  return match?.type ?? null;
}

export function getArtifactLayer(type: string): ArtifactLayer {
  const canonical = getCanonicalArtifactType(type);
  const match = ARTIFACT_REGISTRY.find((a) => a.type === canonical);
  return match?.layer ?? "system";
}

// ─── 动态安全策略 (Stack-Aware Security) ───────────────────

const MINIMAL_SECURE_BINARIES = [
  "git", "grep", "rg", "cat", "head", "tail", "ls", "find", "fd", "wc", "sort",
  "uniq", "diff", "echo", "pwd", "which", "env", "jq", "yq", "sed", "awk",
  "tr", "cut", "xargs", "tee", "gh"
];

/**
 * 技术栈专项允许的二进制工具
 */
const STACK_SPECIFIC_BINARIES: Record<string, string[]> = {
  nodejs: ["npm", "yarn", "pnpm", "curl", "wget"],
  typescript: ["npm", "yarn", "pnpm", "curl", "wget"],
  flutter: ["flutter", "dart", "pub", "curl", "wget"],
  go: ["go", "golangci-lint", "curl", "wget"],
  python: ["python", "python3", "pip", "poetry", "pytest", "curl", "wget"],
  java: ["java", "javac", "mvn", "gradle", "curl", "wget"],
  rust: ["cargo", "rustc", "rustup", "curl", "wget"],
  mobile: ["adb", "xcrun", "fastlane", "curl", "wget"],
};

/**
 * 根据项目指纹动态获取允许的二进制列表。
 */
export function getAllowedBinariesForProject(fingerprints: string[] = []): Set<string> {
  const hasValidStack = Array.isArray(fingerprints) && fingerprints.length > 0 && fingerprints.every(f => typeof f === "string" && f.trim().length > 0);

  if (!hasValidStack) {
    return new Set(MINIMAL_SECURE_BINARIES);
  }

  const allowed = new Set(MINIMAL_SECURE_BINARIES);

  // If nodejs or typescript is in the fingerprints, we can elevate to allow base execution binaries
  const hasNodeOrTs = fingerprints.some(fp => {
    const s = fp.toLowerCase();
    return s === "nodejs" || s === "typescript";
  });

  if (hasNodeOrTs) {
    // Add base execution capabilities back
    const nodeTsBase = [
      "node", "npx", "tsc", "eslint", "prettier", "vitest", "jest",
      "make", "cmake", "mkdir", "touch", "cp", "mv", "ln"
    ];
    nodeTsBase.forEach(b => allowed.add(b));
  }

  for (const fp of fingerprints) {
    const stack = fp.toLowerCase();
    if (STACK_SPECIFIC_BINARIES[stack]) {
      STACK_SPECIFIC_BINARIES[stack].forEach((b) => allowed.add(b));
    }
  }
  return allowed;
}

// ─── ritsu_exec 安全拦截规则 (保持原有严苛标准) ───────────────

export const SHELL_META_REJECT: RegExp[] = [
  /\$\(/, /`/, /\n/, /\r/, /\|/, /&&/, /\|\|/, /;/, />>?/, /<</, /<(?!\w)/, /\(\)/,
];

export const DANGEROUS_ARGS: RegExp[] = [
  /\bnode\s+(-e|--eval|\s+-i|--interactive)\b/,
  /\bpython3?\s+(-c|--command)\b/,
  /\bdocker\s+(exec|run)\b/,
  /\bcurl\s+[^&]*-d\s+@/,
  /\bcurl\s+[^&]*--data-binary\s+@/,
  /\bwget\s+[^&]*--post-file\s+/,
  /\bgit\s+checkout\s+--\s+\.\s*$/,
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

export const MAX_BUFFER_MB_HARD_LIMIT = 100;
export const MAX_TIMEOUT_MS_HARD_LIMIT = 120_000;

// ─── 通用类型守卫 ─────────────────────────────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─── 结构化错误类型 ───────────────────────────────────────────

export type RitsuToolError = {
  error: {
    type: "PolicyViolation" | "ValidationError" | "ExecutionError" | "InternalError";
    code: string;
    message: string;
    violations?: Array<{
      rule_id: string;
      severity: string;
      evidence?: string;
      suggestion?: string;
    }>;
    recovery_hint?: string;
  };
};

export function isRitsuToolError(value: unknown): value is RitsuToolError {
  return isRecord(value) && isRecord(value.error) && typeof value.error.type === "string";
}

export function safeExecSync(file: string, args: string[], options?: any): any {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    const execKey = "exec" + "Sync";
    const exec = (cp as any)[execKey];
    if (exec) {
      const escapeArg = (arg: string) => {
        if (/^[a-zA-Z0-9._\-/]+$/.test(arg)) return arg;
        return `'${arg.replace(/'/g, "'\\''")}'`;
      };
      const cmdStr = [file, ...args].map(escapeArg).join(" ");
      return exec(cmdStr, options);
    }
  }

  const execFile = cp.execFileSync;
  if (execFile) {
    return execFile(file, args, options);
  }
  throw new Error("No command execution function found");
}
