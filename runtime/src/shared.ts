/**
 * 共享路径工具 & 常量 — 单一事实来源
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getSharedDir(): string {
  return process.env.RITSU_SHARED_DIR ?? resolve(__dirname, "../../_shared");
}

// ─── Skill / Stage 语义映射 ────────────────────────────────

export const SKILL_STAGE_MAP: Record<string, string> = {
  think: "think",
  dev: "dev",
  test: "test",
  hunt: "hunt",
  review: "review",
};

export function getStageForSkill(skill: string): string {
  return SKILL_STAGE_MAP[skill] ?? skill;
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
  { type: "dev-report", prefix: "dev-report-", layer: "primary" },
  { type: "assurance-sheet", prefix: "assurance-sheet-", layer: "primary" },
  { type: "handoff", prefix: "handoff-", layer: "evidence" },
  { type: "diagnosis", prefix: "diagnosis-", layer: "evidence" },
  { type: "optimize-report", prefix: "optimize-report-", layer: "evidence" },
  { type: "ctx", prefix: "ctx-", layer: "system" },
];

export const ARTIFACT_VALID_TYPES = ARTIFACT_REGISTRY.map((a) => a.type);
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

/**
 * 基础始终允许的二进制工具
 */
const BASE_ALLOWED_BINARIES = [
  "git", "grep", "rg", "cat", "head", "tail", "ls", "find", "fd", "wc", "sort",
  "uniq", "diff", "echo", "pwd", "which", "env", "node", "npx", "npm", "yarn",
  "pnpm", "tsc", "eslint", "prettier", "vitest", "jest", "jq", "yq", "make",
  "cmake", "sed", "awk", "tr", "cut", "xargs", "tee", "mkdir", "touch", "cp",
  "mv", "ln", "curl", "wget", "gh",
];

/**
 * 技术栈专项允许的二进制工具
 */
const STACK_SPECIFIC_BINARIES: Record<string, string[]> = {
  flutter: ["flutter", "dart", "pub"],
  go: ["go", "golangci-lint"],
  python: ["python", "python3", "pip", "poetry", "pytest"],
  java: ["java", "javac", "mvn", "gradle"],
  rust: ["cargo", "rustc", "rustup"],
  mobile: ["adb", "xcrun", "fastlane"],
};

/**
 * 根据项目指纹动态获取允许的二进制列表。
 */
export function getAllowedBinariesForProject(fingerprints: string[] = []): Set<string> {
  const allowed = new Set(BASE_ALLOWED_BINARIES);
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
