import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runGit } from "./handlers/_git-utils.js";
import { ts } from "./handlers/_utils.js";
import { isRecord } from "./shared.js";

// ─── Adaptive Coverage: risk-based threshold ─────────────────

const CORE_PATTERNS = [
  /\/pay(?:ment)?s?\//,
  /\/checkout\//,
  /\/billing\//,
  /\/crypto(?:gr)?\//,
  /\/encrypt/,
  /\/cipher/,
  /\/auth\//,
  /\/login\//,
  /\/oauth\//,
  /\/session\//,
  /\/middleware\//,
  /\/types\//,
  /\/interfaces\//,
  /contracts?\//,
  /\/core\//,
  /\.d\.ts$/,
  /\/routes\/[^/]+\.ts$/,
];

export type RiskLevel = "core" | "periphery";

/**
 * 对变更文件集进行风险评级。任何匹配核心模式的路径都将整个变更标记为"core"。
 */
export function assessRiskLevel(scanFiles: string[]): RiskLevel {
  for (const file of scanFiles) {
    for (const pattern of CORE_PATTERNS) {
      if (pattern.test(file)) return "core";
    }
  }
  return "periphery";
}

/**
 * 根据风险等级确定覆盖率阈值:
 *   core      → 100% (lines)
 *   periphery → -1 (不要求覆盖率，编译通过即放行)
 */
export function getCoverageThreshold(risk: RiskLevel): number {
  return risk === "core" ? 100 : -1;
}

/**
 * 检查覆盖率是否达到阈值。threshold < 0 视为不要求覆盖率。
 */
export function checkCoverageThreshold(
  pct: number | undefined,
  threshold: number,
): boolean {
  if (threshold < 0) return true;
  return typeof pct === "number" && pct >= threshold;
}

export type QualityGateStepStatus = "passed" | "failed" | "skipped";
export type QualityGateOverallStatus =
  | "passed"
  | "failed"
  | "partially_skipped";

export interface CoverageMetric {
  total: number;
  covered: number;
  skipped?: number;
  pct: number;
}

export interface CoverageStats {
  lines?: CoverageMetric;
  statements?: CoverageMetric;
  functions?: CoverageMetric;
  branches?: CoverageMetric;
  branchesTrue?: CoverageMetric;
}

export type CoverageByFile = Record<string, CoverageStats>;

export interface QualityGateSnapshot {
  recorded_at: string;
  passed: boolean;
  status: QualityGateOverallStatus;
  context?: QualityGateExecutionContext;
  worktree?: QualityGateWorktreeState;
  lint: { status: QualityGateStepStatus; output: string };
  test: {
    status: QualityGateStepStatus;
    failures: unknown[];
    output: string;
  };
  coverage?: {
    summary: CoverageStats;
    per_file: CoverageByFile;
    total?: CoverageStats;
  };
  strict?: boolean;
  /** Waza-style verification claim check. Non-null when unverified claims are found. */
  verification_warning?: string;
}

export interface QualityGateExecutionContext {
  correlation_id?: string;
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
  skill?: string;
  domain?: string;
}

export interface QualityGateWorktreeDiffState {
  files: string[];
  patch_hash: string;
}

export interface QualityGateWorktreeUntrackedState {
  files: string[];
  content_hash: string;
}

export interface QualityGateWorktreeState {
  fingerprint: string;
  head?: string;
  staged: QualityGateWorktreeDiffState;
  unstaged: QualityGateWorktreeDiffState;
  untracked: QualityGateWorktreeUntrackedState;
}


function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStepStatus(value: unknown): value is QualityGateStepStatus {
  return value === "passed" || value === "failed" || value === "skipped";
}

function isCoverageMetric(value: unknown): value is CoverageMetric {
  if (!isRecord(value)) return false;
  return (
    typeof value.total === "number" &&
    typeof value.covered === "number" &&
    (value.skipped === undefined || typeof value.skipped === "number") &&
    typeof value.pct === "number"
  );
}

function isCoverageStats(value: unknown): value is CoverageStats {
  if (!isRecord(value)) return false;
  return (
    (value.lines === undefined || isCoverageMetric(value.lines)) &&
    (value.statements === undefined || isCoverageMetric(value.statements)) &&
    (value.functions === undefined || isCoverageMetric(value.functions)) &&
    (value.branches === undefined || isCoverageMetric(value.branches)) &&
    (value.branchesTrue === undefined || isCoverageMetric(value.branchesTrue))
  );
}

function isWorktreeDiffState(value: unknown): value is QualityGateWorktreeDiffState {
  if (!isRecord(value)) return false;
  return typeof value.patch_hash === "string" && isStringArray(value.files);
}

function isWorktreeUntrackedState(
  value: unknown,
): value is QualityGateWorktreeUntrackedState {
  if (!isRecord(value)) return false;
  return typeof value.content_hash === "string" && isStringArray(value.files);
}

function isWorktreeState(value: unknown): value is QualityGateWorktreeState {
  if (!isRecord(value)) return false;
  return (
    typeof value.fingerprint === "string" &&
    (value.head === undefined || typeof value.head === "string") &&
    isWorktreeDiffState(value.staged) &&
    isWorktreeDiffState(value.unstaged) &&
    isWorktreeUntrackedState(value.untracked)
  );
}

export function computeOverallStatus(
  lintStatus: QualityGateStepStatus,
  testStatus: QualityGateStepStatus,
): { passed: boolean; status: QualityGateOverallStatus } {
  const allPassed = lintStatus === "passed" && testStatus === "passed";
  const anyFailed = lintStatus === "failed" || testStatus === "failed";
  return {
    passed: allPassed && !anyFailed,
    status: anyFailed ? "failed" : allPassed ? "passed" : "partially_skipped",
  };
}

/**
 * Waza-style verification claims check.
 * Scans output for unverified claims like "tests pass" / "已验证"
 * when there's no actual test result available.
 */
export function checkVerificationClaims(input: {
  lint: { status: QualityGateStepStatus; output: string };
  test: {
    status: QualityGateStepStatus;
    failures: unknown[];
    output: string };
}): string | null {
  // If tests actually ran, no issue
  if (input.test.status !== "skipped" || input.lint.status !== "skipped") return null;

  const CLAIM_PATTERNS = [
    /\b(?:tests?|all)\s+(?:pass|passed|绿色|通过)\b/i,
    /\bverified\b/i,
    /\b验证通过\b/,
    /(?:测试|检查)\s*全部通过/,
    /\bno\s+(?:issues|errors|failures)\b/i,
  ];

  const lintOutput = input.lint.output ?? "";
  const testOutput = input.test.output ?? "";
  const combined = `${lintOutput} ${testOutput}`;

  for (const pattern of CLAIM_PATTERNS) {
    if (pattern.test(combined)) {
      return `Unverified claim detected: matched "${pattern.source}". Tests were skipped — provide actual execution evidence.`;
    }
  }
  return null;
}

export function buildQualityGateSnapshot(input: {
  context?: QualityGateExecutionContext;
  worktree?: QualityGateWorktreeState;
  lint: { status: QualityGateStepStatus; output: string };
  test: {
    status: QualityGateStepStatus;
    failures: unknown[];
    output: string;
  };
  coverage?: {
    summary: CoverageStats;
    per_file: CoverageByFile;
  };
  strict?: boolean;
}): QualityGateSnapshot {
  const overall = computeOverallStatus(input.lint.status, input.test.status);
  const verificationWarning = checkVerificationClaims(input);

  return {
    recorded_at: ts(),
    passed: overall.passed,
    status: overall.status,
    verification_warning: verificationWarning ?? undefined,
    context:
      input.context && Object.keys(input.context).length > 0
        ? input.context
        : undefined,
    worktree: input.worktree,
    lint: input.lint,
    test: input.test,
    coverage: input.coverage
      ? {
          ...input.coverage,
          total: input.coverage.summary,
        }
      : undefined,
    strict: input.strict,
  };
}

export function parseQualityGateSnapshot(
  raw: unknown,
): QualityGateSnapshot | null {
  if (!isRecord(raw)) return null;
  if (!isRecord(raw.lint) || !isRecord(raw.test)) return null;

  const lintStatus = raw.lint.status;
  const testStatus = raw.test.status;
  if (!isStepStatus(lintStatus) || !isStepStatus(testStatus)) {
    return null;
  }

  const lintOutput =
    typeof raw.lint.output === "string" ? raw.lint.output : "";
  const testOutput =
    typeof raw.test.output === "string" ? raw.test.output : "";
  const failures = Array.isArray(raw.test.failures) ? raw.test.failures : [];

  let coverage: QualityGateSnapshot["coverage"] | undefined;
  if (raw.coverage !== undefined) {
    if (!isRecord(raw.coverage)) return null;

    const summarySource = isCoverageStats(raw.coverage.summary)
      ? raw.coverage.summary
      : isCoverageStats(raw.coverage.total)
        ? raw.coverage.total
        : null;
    if (!summarySource) return null;

    const perFileSource = isRecord(raw.coverage.per_file)
      ? raw.coverage.per_file
      : {};
    const perFile: CoverageByFile = {};
    for (const [file, stats] of Object.entries(perFileSource)) {
      if (isCoverageStats(stats)) {
        perFile[file] = stats;
      }
    }

    coverage = {
      summary: summarySource,
      per_file: perFile,
      total: summarySource,
    };
  }

  let context: QualityGateExecutionContext | undefined;
  if (raw.context !== undefined) {
    if (!isRecord(raw.context)) return null;
    context = {};
    for (const key of [
      "correlation_id",
      "trace_id",
      "span_id",
      "parent_span_id",
      "skill",
      "domain",
    ] as const) {
      const value = raw.context[key];
      if (typeof value === "string" && value.trim()) {
        context[key] = value;
      }
    }
  }

  const worktree = raw.worktree === undefined
    ? undefined
    : isWorktreeState(raw.worktree)
      ? raw.worktree
      : null;
  if (worktree === null) return null;

  const overall = computeOverallStatus(lintStatus, testStatus);
  return {
    recorded_at:
      typeof raw.recorded_at === "string" && raw.recorded_at
        ? raw.recorded_at
        : ts(),
    passed: typeof raw.passed === "boolean" ? raw.passed : overall.passed,
    status:
      raw.status === "passed" ||
      raw.status === "failed" ||
      raw.status === "partially_skipped"
        ? raw.status
        : overall.status,
    context,
    worktree,
    lint: {
      status: lintStatus,
      output: lintOutput,
    },
    test: {
      status: testStatus,
      failures,
      output: testOutput,
    },
    coverage,
    strict: typeof raw.strict === "boolean" ? raw.strict : undefined,
  };
}

export function readQualityGateSnapshot(root: string):
  | { ok: true; snapshot: QualityGateSnapshot; path: string }
  | { ok: false; reason: "missing" | "invalid"; message: string; path: string } {
  const path = resolve(root, ".ritsu/last-quality-gate.json");
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: "missing",
      message: "no quality gate snapshot found; run ritsu_run_quality_gates first",
      path,
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    const snapshot = parseQualityGateSnapshot(parsed);
    if (!snapshot) {
      return {
        ok: false,
        reason: "invalid",
        message: "quality gate snapshot is malformed",
        path,
      };
    }
    return { ok: true, snapshot, path };
  } catch {
    return {
      ok: false,
      reason: "invalid",
      message: "quality gate snapshot is not valid JSON",
      path,
    };
  }
}

function pickContextValue(
  params: Record<string, unknown>,
  key: keyof QualityGateExecutionContext,
): unknown {
  if (params[key] !== undefined) {
    return params[key];
  }
  const context =
    params.context &&
    typeof params.context === "object" &&
    !Array.isArray(params.context)
      ? (params.context as Record<string, unknown>)
      : undefined;
  return context?.[key];
}

export function extractQualityGateExecutionContext(
  params: Record<string, unknown>,
): QualityGateExecutionContext {
  const context: QualityGateExecutionContext = {};
  for (const key of [
    "correlation_id",
    "trace_id",
    "span_id",
    "parent_span_id",
    "skill",
    "domain",
  ] as const) {
    const value = pickContextValue(params, key);
    if (typeof value === "string" && value.trim()) {
      context[key] = value.trim();
    }
  }
  return context;
}

const QUALITY_GATE_GIT_PATHSPEC = [".", ":(exclude).ritsu/**"];
const QUALITY_GATE_GIT_MAX_BYTES = 20 * 1024 * 1024;

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

function hashBuffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseGitPathList(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeHeadValue(value: string | undefined): string {
  return value?.trim() || "(no HEAD)";
}

function formatWorktreeFiles(files: string[]): string {
  return files.length > 0 ? files.join(", ") : "(none)";
}

function formatWorktreeDiffSummary(
  label: "staged" | "unstaged",
  state: QualityGateWorktreeDiffState,
): string[] {
  return [
    `${label} files: ${formatWorktreeFiles(state.files)}`,
    `${label} patch_hash: ${state.patch_hash}`,
  ];
}

function formatWorktreeUntrackedSummary(
  state: QualityGateWorktreeUntrackedState,
): string[] {
  return [
    `untracked files: ${formatWorktreeFiles(state.files)}`,
    `untracked content_hash: ${state.content_hash}`,
  ];
}

function formatWorktreeStateSummary(state: QualityGateWorktreeState): string[] {
  return [
    `head: ${normalizeHeadValue(state.head)}`,
    ...formatWorktreeDiffSummary("staged", state.staged),
    ...formatWorktreeDiffSummary("unstaged", state.unstaged),
    ...formatWorktreeUntrackedSummary(state.untracked),
    `worktree fingerprint: ${state.fingerprint}`,
  ];
}

async function runWorktreeGitCommand(
  root: string,
  args: string[],
  maxBytes = QUALITY_GATE_GIT_MAX_BYTES,
): Promise<{ ok: boolean; output: string }> {
  return runGit(args, root, maxBytes);
}

function buildWorktreeFingerprint(state: {
  head?: string;
  staged: QualityGateWorktreeDiffState;
  unstaged: QualityGateWorktreeDiffState;
  untracked: QualityGateWorktreeUntrackedState;
}): string {
  return hashText(JSON.stringify(state));
}

export async function captureQualityGateWorktreeState(
  root: string,
): Promise<
  | { ok: true; worktree: QualityGateWorktreeState }
  | { ok: false; reason: "unsupported" | "unavailable"; message: string }
> {
  const repoCheck = await runWorktreeGitCommand(root, [
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  if (!repoCheck.ok || repoCheck.output.trim() !== "true") {
    return {
      ok: false,
      reason: "unsupported",
      message: "git worktree state is unavailable for this project root",
    };
  }

  const [headResult, stagedFilesResult, unstagedFilesResult, stagedPatchResult, unstagedPatchResult, untrackedFilesResult] =
    await Promise.all([
      runWorktreeGitCommand(root, ["rev-parse", "--verify", "HEAD"]),
      runWorktreeGitCommand(root, [
        "diff",
        "--name-only",
        "--cached",
        "--no-ext-diff",
        "--",
        ...QUALITY_GATE_GIT_PATHSPEC,
      ]),
      runWorktreeGitCommand(root, [
        "diff",
        "--name-only",
        "--no-ext-diff",
        "--",
        ...QUALITY_GATE_GIT_PATHSPEC,
      ]),
      runWorktreeGitCommand(root, [
        "diff",
        "--binary",
        "--cached",
        "--no-ext-diff",
        "--",
        ...QUALITY_GATE_GIT_PATHSPEC,
      ]),
      runWorktreeGitCommand(root, [
        "diff",
        "--binary",
        "--no-ext-diff",
        "--",
        ...QUALITY_GATE_GIT_PATHSPEC,
      ]),
      runWorktreeGitCommand(root, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "--",
        ...QUALITY_GATE_GIT_PATHSPEC,
      ]),
    ]);

  for (const result of [
    stagedFilesResult,
    unstagedFilesResult,
    stagedPatchResult,
    unstagedPatchResult,
    untrackedFilesResult,
  ]) {
    if (!result.ok) {
      return {
        ok: false,
        reason: "unavailable",
        message: result.output || "git worktree inspection failed",
      };
    }
  }

  const untrackedFiles = parseGitPathList(untrackedFilesResult.output);
  const untrackedEntries = untrackedFiles.map((file) => {
    const absPath = resolve(root, file);
    if (!existsSync(absPath)) {
      return `${file}:<missing>`;
    }
    try {
      return `${file}:${hashBuffer(readFileSync(absPath))}`;
    } catch {
      return `${file}:<unreadable>`;
    }
  });

  const staged: QualityGateWorktreeDiffState = {
    files: parseGitPathList(stagedFilesResult.output),
    patch_hash: hashText(stagedPatchResult.output),
  };
  const unstaged: QualityGateWorktreeDiffState = {
    files: parseGitPathList(unstagedFilesResult.output),
    patch_hash: hashText(unstagedPatchResult.output),
  };
  const untracked: QualityGateWorktreeUntrackedState = {
    files: untrackedFiles,
    content_hash: hashText(untrackedEntries.join("\n")),
  };
  const head = headResult.ok ? headResult.output.trim() || undefined : undefined;
  const worktree: QualityGateWorktreeState = {
    head,
    staged,
    unstaged,
    untracked,
    fingerprint: buildWorktreeFingerprint({
      head,
      staged,
      unstaged,
      untracked,
    }),
  };

  return { ok: true, worktree };
}

export function validateQualityGateSnapshotContext(
  snapshot: QualityGateSnapshot,
  current: QualityGateExecutionContext,
): {
  ok: true;
} | {
  ok: false;
  message: string;
  expected: string[];
  actual: string[];
} {
  const traceId = current.trace_id?.trim();
  const spanId = current.span_id?.trim();
  const correlationId = current.correlation_id?.trim();
  const snapshotContext = snapshot.context ?? {};

  if (!traceId && !spanId && !correlationId) {
    return { ok: true };
  }

  if (spanId) {
    if (!snapshotContext.span_id) {
      return {
        ok: false,
        message:
          "latest quality gate snapshot is not bound to the current span; rerun ritsu_run_quality_gates with the active trace/span context",
        expected: [`span_id: ${spanId}`],
        actual: [
          snapshotContext.trace_id
            ? `trace_id: ${snapshotContext.trace_id}`
            : "snapshot has no bound span_id",
        ],
      };
    }
    if (snapshotContext.span_id !== spanId) {
      return {
        ok: false,
        message:
          "latest quality gate snapshot belongs to a different span; rerun ritsu_run_quality_gates in the current execution span",
        expected: [`span_id: ${spanId}`],
        actual: [`span_id: ${snapshotContext.span_id}`],
      };
    }
  }

  if (traceId) {
    if (!snapshotContext.trace_id) {
      return {
        ok: false,
        message:
          "latest quality gate snapshot is not bound to the current trace; rerun ritsu_run_quality_gates with the active trace context",
        expected: [`trace_id: ${traceId}`],
        actual: [
          snapshotContext.correlation_id
            ? `correlation_id: ${snapshotContext.correlation_id}`
            : "snapshot has no bound trace_id",
        ],
      };
    }
    if (snapshotContext.trace_id !== traceId) {
      return {
        ok: false,
        message:
          "latest quality gate snapshot belongs to a different trace; rerun ritsu_run_quality_gates for the current task chain",
        expected: [`trace_id: ${traceId}`],
        actual: [`trace_id: ${snapshotContext.trace_id}`],
      };
    }
  }

  if (correlationId && !traceId && !spanId) {
    if (!snapshotContext.correlation_id) {
      return {
        ok: false,
        message:
          "latest quality gate snapshot is not bound to the current correlation_id; rerun ritsu_run_quality_gates for this task",
        expected: [`correlation_id: ${correlationId}`],
        actual: ["snapshot has no bound correlation_id"],
      };
    }
    if (snapshotContext.correlation_id !== correlationId) {
      return {
        ok: false,
        message:
          "latest quality gate snapshot belongs to a different task correlation_id; rerun ritsu_run_quality_gates for the current task",
        expected: [`correlation_id: ${correlationId}`],
        actual: [`correlation_id: ${snapshotContext.correlation_id}`],
      };
    }
  }

  return { ok: true };
}

export async function validateQualityGateSnapshotWorktree(
  root: string,
  snapshot: QualityGateSnapshot,
): Promise<
  | { ok: true }
  | {
      ok: false;
      message: string;
      expected: string[];
      actual: string[];
    }
> {
  if (!snapshot.worktree) {
    return { ok: true };
  }

  const currentResult = await captureQualityGateWorktreeState(root);
  if (!currentResult.ok) {
    return {
      ok: false,
      message: `unable to verify worktree freshness against the latest quality gate snapshot: ${currentResult.message}`,
      expected: formatWorktreeStateSummary(snapshot.worktree),
      actual: [currentResult.message],
    };
  }

  const current = currentResult.worktree;
  const expected = snapshot.worktree;

  if (normalizeHeadValue(current.head) !== normalizeHeadValue(expected.head)) {
    return {
      ok: false,
      message: "git HEAD changed after quality gates ran; rerun ritsu_run_quality_gates before delivery",
      expected: [`head: ${normalizeHeadValue(expected.head)}`],
      actual: [`head: ${normalizeHeadValue(current.head)}`],
    };
  }

  if (current.staged.patch_hash !== expected.staged.patch_hash) {
    return {
      ok: false,
      message:
        "staged changes differ from the state validated by quality gates; rerun ritsu_run_quality_gates before delivery",
      expected: formatWorktreeDiffSummary("staged", expected.staged),
      actual: formatWorktreeDiffSummary("staged", current.staged),
    };
  }

  if (current.unstaged.patch_hash !== expected.unstaged.patch_hash) {
    return {
      ok: false,
      message:
        "unstaged changes differ from the state validated by quality gates; rerun ritsu_run_quality_gates before delivery",
      expected: formatWorktreeDiffSummary("unstaged", expected.unstaged),
      actual: formatWorktreeDiffSummary("unstaged", current.unstaged),
    };
  }

  if (current.untracked.content_hash !== expected.untracked.content_hash) {
    return {
      ok: false,
      message:
        "untracked files differ from the state validated by quality gates; rerun ritsu_run_quality_gates before delivery",
      expected: formatWorktreeUntrackedSummary(expected.untracked),
      actual: formatWorktreeUntrackedSummary(current.untracked),
    };
  }

  if (current.fingerprint !== expected.fingerprint) {
    return {
      ok: false,
      message:
        "working tree changed after quality gates ran; rerun ritsu_run_quality_gates before delivery",
      expected: formatWorktreeStateSummary(expected),
      actual: formatWorktreeStateSummary(current),
    };
  }

  return { ok: true };
}

export function normalizeQualityGateStatusToken(
  value: string,
): QualityGateStepStatus | QualityGateOverallStatus | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === "passed" || normalized === "通过") return "passed";
  if (normalized === "failed" || normalized === "失败") return "failed";
  if (normalized === "skipped" || normalized === "跳过") return "skipped";
  if (
    normalized === "partially_skipped" ||
    normalized === "partial" ||
    normalized === "部分跳过"
  ) {
    return "partially_skipped";
  }

  return null;
}

export function parseQualityGatePct(value: string): number | null {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const pct = Number(match[0]);
  return Number.isFinite(pct) ? pct : null;
}
