/**
 * Context Lifecycle Manager
 *
 * AI 编码代理的核心痛点：会话断裂后上下文丢失。
 *
 * 这个模块解决两个问题：
 * 1. 检查点恢复 —— 在 step/artifact/span 边界自动保存结构化上下文，
 *    新会话通过 preflight 无缝恢复"正在做什么、做到哪、还有什么没做"。
 * 2. 上下文优先级 —— 标记永不压缩的项（活跃契约/违规），
 *    在 token 预算紧张时指导压缩哪些内容。
 *
 * 设计原则：
 * - 零新依赖：复用 bun:sqlite + JSONL，不引入 tiktoken/lz-string 等包
 * - 重入安全：多次保存检查点不丢失信息，幂等写入
 * - 可审计：检查点是 JSON，直接可读可改
 *
 * v8.1.0
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { readAllEntries } from "./ctx-reader.js";
import { getOpenViolations } from "./violation-tracker.js";

// ─── Types ────────────────────────────────────────────────────

export interface ViolationSummary {
  rule_id: string;
  severity: string;
  message: string;
  file_hint: string;
  fixed: boolean;
}

export interface Checkpoint {
  ts: string;
  trace_id: string;
  correlation_id: string;
  skill: string;
  step: number;
  total_steps: number;
  goal: string;
  completed: string[];
  pending: string[];
  active_contracts: string[];
  active_violations: ViolationSummary[];
  working_files: string[];
  key_decisions: string[];
  token_estimate: number;
}

export interface ContextManifest {
  updated_at: string;
  trace_id: string;
  skill: string;
  goal: string;
  total_tokens: number;
  high_water_mark: number; // peak token usage this session

  pinned: ContextEntry[];
  high: ContextEntry[];
  normal: ContextEntry[];
  low: ContextEntry[];
}

export interface ContextEntry {
  id: string;
  category: "contract" | "violation" | "task" | "file" | "decision" | "result" | "log";
  summary: string;
  created_at: string;
  accessed_at: string;
  tokens: number;
}

// ─── Constants ────────────────────────────────────────────────

const CHECKPOINT_DIR = "checkpoints";
const CONTEXT_FILE = "context-manifest.json";
const DEFAULT_BUDGET = 64_000; // conservative for most models
const MAX_CHECKPOINTS = 20;

const RULES_OF_THUMB = {
  max_checkpoints: MAX_CHECKPOINTS,
  retention_minutes: 60,
  budget_fraction: 0.6, // keep context below 60% of budget
  char_to_token_ratio: 4, // rough: 4 chars ≈ 1 token (for code-heavy text)
  compressed_ratio: 0.4, // compressed summary is 40% of original size
};

// ─── Token Estimation ─────────────────────────────────────────

/**
 * Estimate tokens from string length.
 * OpenAI/tiktoken 的精确定量在 Lifecycle 场景没有必要，
 * 启发式估算足以判断"是否接近预算上限"。
 * 代码文本的特点是中英文混合，4 chars/token 是经验修正值。
 */
export function estimateTokens(text: string): number {
  // Count ASCII vs non-ASCII characters for better estimation
  let ascii = 0;
  let nonAscii = 0;

  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) {
      ascii++;
    } else {
      nonAscii++;
    }
  }

  // ASCII: ~4 chars per token (code/text)
  // CJK/Unicode: ~1.5 chars per token
  return Math.ceil(ascii / 4 + nonAscii / 1.5);
}

// ─── Checkpoint Paths ─────────────────────────────────────────

function getCheckpointDir(projectRoot: string): string {
  const dir = resolve(projectRoot, ".ritsu", CHECKPOINT_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getContextManifestPath(projectRoot: string): string {
  return resolve(projectRoot, ".ritsu", CONTEXT_FILE);
}

function getLatestSymlink(projectRoot: string): string {
  return resolve(projectRoot, ".ritsu", "latest-checkpoint.json");
}

// ─── Checkpoint Operations ────────────────────────────────────

/**
 * Build a checkpoint from ctx events.
 * Scans recent events to extract structured recovery context.
 */
export function buildCheckpoint(
  projectRoot: string,
  skill: string,
  goal: string,
): Checkpoint | null {
  const events = readAllEntries(projectRoot);
  if (events.length === 0) return null;

  // Find the active trace (last started, not yet completed)
  const openTraces = new Set<string>();
  const traceEnded = new Set<string>();

  // First pass: find open traces
  for (const evt of events) {
    const e = evt as Record<string, unknown>;
    // Handle both old and new format
    const traceId = String(e.trace_id ?? e.correlation_id ?? "");
    const status = String(e.status ?? "");
    const eventSkill = String(e.skill ?? "");

    // Only care about events matching our skill or general events
    if (eventSkill && eventSkill !== skill && eventSkill !== "unknown") continue;
    if (!traceId || traceId === "undefined" || traceId === "null") continue;

    if (status === "started") {
      openTraces.add(traceId);
    } else if (status === "done" || status === "failed") {
      traceEnded.add(traceId);
    }
  }

  // Remove ended traces from open set
  for (const ended of traceEnded) {
    openTraces.delete(ended);
  }

  const activeTrace = [...openTraces].pop();

  // Extract events for our trace or use all recent events
  const relevantEvents = activeTrace
    ? events.filter((e) => {
        const evt = e as Record<string, unknown>;
        const tid = String(evt.trace_id ?? evt.correlation_id ?? "");
        return tid === activeTrace;
      })
    : events.slice(-50); // last 50 events as fallback

  // Extract step summary
  let currentStep = 0;
  let totalSteps = 0;
  const completed: string[] = [];
  const pending: string[] = [];

  for (const evt of relevantEvents) {
    const e = evt as Record<string, unknown>;
    const status = String(e.status ?? "");
    const step = String(e.step ?? "");

    if (status === "started" && step) {
      if (step.startsWith("step-")) {
        const stepNum = parseInt(step.replace("step-", ""), 10);
        if (!isNaN(stepNum)) currentStep = Math.max(currentStep, stepNum);
      }
    }

    if (status === "done" && String(e.skill ?? "") === skill) {
      if (step) {
        completed.push(step);
      }
    }
  }

  if (typeof totalSteps === "number" && totalSteps === 0) {
    totalSteps = 5; // default skill has 4-5 steps
  }

  // Extract working files from artifact_written events
  const workingFiles = new Set<string>();
  const activeContracts: string[] = [];
  const activeViolations: ViolationSummary[] = [];
  const keyDecisions: string[] = [];
  let goalStr = goal;

  for (const evt of relevantEvents) {
    const e = evt as Record<string, unknown>;
    const status = String(e.status ?? "");
    const artifactMeta = e.artifact_meta as Record<string, unknown> | undefined;
    const violation = e.violation as Record<string, unknown> | undefined;

    if (status === "artifact_written") {
      const path = String(e.artifact ?? "");
      if (path) {
        workingFiles.add(path);
      }
      const canonicalType = String(artifactMeta?.canonical_type ?? "");
      const summary = String(artifactMeta?.summary ?? "");

      if (canonicalType === "design_sheet" && summary) {
        // Extract contract references from summary
        const cMatches = summary.match(/\b(C\d+|OS-\S+)\b/g);
        if (cMatches) {
          cMatches.forEach((c) => activeContracts.push(c));
        }
        goalStr = goalStr || summary.slice(0, 200);
      }
    }

    if (violation) {
      const ruleId = String(violation.rule_id ?? "");
      if (ruleId) {
        activeViolations.push({
          rule_id: ruleId,
          severity: String(violation.severity ?? "warn"),
          message: String(violation.evidence ?? ruleId).slice(0, 100),
          file_hint: extractFileHint(String(violation.evidence ?? "")),
          fixed: false, // will be updated if we see a fix
        });
      }
    }

    // Check for "revert" events that mark violations as fixed
    if (status === "done" && String(e.skill ?? "") === "dev") {
      const errors = String(e.error ?? "");
      if (errors.toLowerCase().includes("fix")) {
        // Mark matching violations as fixed
        for (const v of activeViolations) {
          if (errors.includes(v.rule_id) || errors.includes(v.file_hint)) {
            v.fixed = true;
          }
        }
      }
    }
  }

  // Merge with violation tracker's open violations
  try {
    const trackerViolations = getOpenViolations(projectRoot);
    for (const tv of trackerViolations) {
      const exists = activeViolations.some(
        (av) => av.rule_id === tv.rule_id && av.file_hint === tv.file,
      );
      if (!exists) {
        activeViolations.push({
          rule_id: tv.rule_id,
          severity: tv.severity,
          message: tv.message,
          file_hint: tv.file,
          fixed: false,
        });
      }
    }
  } catch {
    // best-effort
  }

  // Deduplicate contracts
  const uniqueContracts = [...new Set(activeContracts)];

  // Calculate pending steps (steps not yet done)
  const allSteps = generateStepNames(currentStep, skill);
  for (const step of allSteps) {
    if (!completed.includes(step)) {
      pending.push(step);
    }
  }

  // Estimate total tokens in relevant events
  const totalText = relevantEvents.map((e) => JSON.stringify(e)).join("\n");
  const tokenEstimate = estimateTokens(totalText);

  return {
    ts: new Date().toISOString(),
    trace_id: activeTrace || "",
    correlation_id: activeTrace || "",
    skill,
    step: currentStep,
    total_steps: totalSteps,
    goal: goalStr,
    completed: [...new Set(completed)],
    pending,
    active_contracts: uniqueContracts.slice(0, 20),
    active_violations: activeViolations,
    working_files: [...workingFiles].slice(0, 30),
    key_decisions: keyDecisions.slice(-10),
    token_estimate: tokenEstimate,
  };
}

function extractFileHint(evidence: string): string {
  // Evidence format: "file.ts:12:34 — message"
  const match = evidence.match(/^([^:\s]+(?:\.[a-zA-Z]+)?)/);
  return match ? match[1] : "";
}

function generateStepNames(currentStep: number, skill: string): string[] {
  if (skill === "dev") return ["step-1", "step-2", "step-3", "step-4", "step-5"];
  if (skill === "think") return ["step-1", "step-2", "step-3", "step-4"];
  if (skill === "review") return ["step-1", "step-2", "step-3", "step-4"];
  if (skill === "hunt") return ["step-1", "step-2", "step-3", "step-4"];
  if (skill === "deploy") return ["step-1", "step-2", "step-3", "step-4", "step-5"];
  if (skill === "augment") return ["step-1", "step-2", "step-3", "step-4"];
  return ["step-1", "step-2", "step-3"];
}

/**
 * Save a checkpoint to disk.
 * Maintains rolling window of MAX_CHECKPOINTS recent checkpoints.
 */
export function saveCheckpoint(
  projectRoot: string,
  checkpoint: Checkpoint,
): string {
  const dir = getCheckpointDir(projectRoot);
  const filename = `cp-${checkpoint.ts.replace(/[:.]/g, "-")}.json`;
  const filepath = resolve(dir, filename);

  writeFileSync(filepath, JSON.stringify(checkpoint, null, 2), "utf-8");

  // Update latest symlink
  writeFileSync(getLatestSymlink(projectRoot), filepath, "utf-8");

  // Prune old checkpoints: keep only the MAX_CHECKPOINTS most recent
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("cp-"))
    .map((f) => resolve(dir, f))
    .sort()
    .reverse();

  if (files.length > MAX_CHECKPOINTS) {
    for (const old of files.slice(MAX_CHECKPOINTS)) {
      try {
        if (existsSync(old) && !old.includes("latest")) {
          const { unlinkSync } = require("node:fs") as typeof import("node:fs");
          unlinkSync(old);
        }
      } catch {
        // best effort cleanup
      }
    }
  }

  return filepath;
}

/**
 * Load the latest checkpoint, searching in order:
 * 1. latest-checkpoint.json symlink
 * 2. Most recent file in checkpoints/ directory
 */
export function loadLatestCheckpoint(
  projectRoot: string,
): Checkpoint | null {
  // Try symlink first
  const symlinkPath = getLatestSymlink(projectRoot);
  if (existsSync(symlinkPath)) {
    try {
      const target = readFileSync(symlinkPath, "utf-8").trim();
      if (existsSync(target)) {
        const content = readFileSync(target, "utf-8");
        return JSON.parse(content) as Checkpoint;
      }
    } catch {
      // fall through
    }
  }

  // Search checkpoint directory
  const dir = getCheckpointDir(projectRoot);
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir)
    .filter((f) => f.startsWith("cp-") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  try {
    const content = readFileSync(resolve(dir, files[0]), "utf-8");
    return JSON.parse(content) as Checkpoint;
  } catch {
    return null;
  }
}

/**
 * Check if a checkpoint is still fresh (within retention window).
 */
export function isCheckpointFresh(
  checkpoint: Checkpoint,
  retentionMinutes = RULES_OF_THUMB.retention_minutes,
): boolean {
  const age = Date.now() - new Date(checkpoint.ts).getTime();
  return age < retentionMinutes * 60 * 1000;
}

/**
 * Generate a structured recovery prompt from a checkpoint.
 * This is the core value prop: inject this into a new session
 * so the agent knows exactly what it was doing.
 */
export function generateRecoveryPrompt(checkpoint: Checkpoint): string {
  const lines: string[] = [];
  const isFresh = isCheckpointFresh(checkpoint);

  lines.push(`# 🚀 会话恢复 — ${isFresh ? "热恢复" : "冷恢复"}`);
  lines.push(``);

  if (!isFresh) {
    lines.push(`> ⚠️ 检查点已超过 ${RULES_OF_THUMB.retention_minutes} 分钟，建议确认上下文是否仍然有效。`);
    lines.push(``);
  }

  lines.push(`## 当前任务`);
  lines.push(`**Skill**: ${checkpoint.skill}`);
  lines.push(`**目标**: ${checkpoint.goal || "（未记录目标）"}`);
  lines.push(`**进度**: Step ${Math.max(1, checkpoint.step)} / ${checkpoint.total_steps}`);
  lines.push(`**Trace**: ${checkpoint.trace_id || "unknown"}`);
  lines.push(``);

  if (checkpoint.completed.length > 0) {
    lines.push(`## ✅ 已完成`);
  for (const step of checkpoint.completed) {
    lines.push(`- ${step}`);
  }
    lines.push(``);
  }

  if (checkpoint.pending.length > 0) {
    lines.push(`## 📋 待完成`);
    for (const step of checkpoint.pending) {
      lines.push(`- [ ] ${step}`);
    }
    lines.push(``);
  }

  if (checkpoint.active_contracts.length > 0) {
    lines.push(`## 📌 活跃契约`);
    for (const c of checkpoint.active_contracts) {
      lines.push(`- ${c}`);
    }
    lines.push(``);
  }

  if (checkpoint.active_violations.length > 0) {
    const unresolved = checkpoint.active_violations.filter((v) => !v.fixed);
    if (unresolved.length > 0) {
      lines.push(`## ⚠️ 待修复违规`);
      for (const v of unresolved) {
        lines.push(`- ${v.rule_id} (${v.severity}): ${v.message}`);
      }
      lines.push(``);
    }
  }

  if (checkpoint.working_files.length > 0) {
    lines.push(`## 📁 工作文件`);
    for (const f of checkpoint.working_files) {
      lines.push(`- \`${f}\``);
    }
    lines.push(``);
  }

  if (checkpoint.key_decisions.length > 0) {
    lines.push(`## 📝 关键决策`);
    for (const d of checkpoint.key_decisions) {
      lines.push(`- ${d}`);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*检查点: ${checkpoint.ts} | Token 估算: ${checkpoint.token_estimate}*`);

  return lines.join("\n");
}

// ─── Context Manifest ─────────────────────────────────────────

/**
 * Read or initialize the context manifest.
 */
export function readOrInitManifest(projectRoot: string): ContextManifest {
  const path = getContextManifestPath(projectRoot);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as ContextManifest;
    } catch {
      // fall through to init
    }
  }

  return {
    updated_at: new Date().toISOString(),
    trace_id: "",
    skill: "",
    goal: "",
    total_tokens: 0,
    high_water_mark: 0,
    pinned: [],
    high: [],
    normal: [],
    low: [],
  };
}

/**
 * Save the context manifest.
 */
export function saveManifest(projectRoot: string, manifest: ContextManifest): void {
  manifest.updated_at = new Date().toISOString();
  const path = getContextManifestPath(projectRoot);
  writeFileSync(path, JSON.stringify(manifest, null, 2), "utf-8");
}

/**
 * Calculate token budget and remaining capacity.
 */
export function getBudgetStatus(manifest: ContextManifest): {
  total: number;
  high_water: number;
  budget: number;
  remaining: number;
  utilization_pct: number;
  needs_compression: boolean;
} {
  const budget = Math.floor(DEFAULT_BUDGET * RULES_OF_THUMB.budget_fraction);
  const hwm = manifest.high_water_mark;
  const remaining = Math.max(0, budget - hwm);
  const pct = Math.round((hwm / budget) * 100);

  return {
    total: manifest.total_tokens,
    high_water: hwm,
    budget,
    remaining,
    utilization_pct: pct,
    needs_compression: pct > 85,
  };
}

/**
 * Generate a compression hint for the next preflight, based on
 * the context manifest state.
 */
export function generateCompressionHint(manifest: ContextManifest): string {
  const status = getBudgetStatus(manifest);
  if (!status.needs_compression) return "";

  const droppable = [
    ...manifest.low.map((e) => `- 🗑️ \`${e.id}\`: ${e.summary}`),
    ...manifest.normal.slice(5).map((e) => `- 📋 \`${e.id}\`: ${e.summary}`),
  ];

  if (droppable.length === 0) return "";

  const lines: string[] = [
    `## ⚡ Token 预算接近上限`,
    ``,
    `利用率: ${status.utilization_pct}% (${status.high_water}/${status.budget})`,
    ``,
    `建议丢弃以下低优先级上下文以释放空间：`,
    ...droppable.slice(0, 8),
    ``,
  ];

  return lines.join("\n");
}

// ─── Auto Checkpoint (called from handlers) ──────────────────

/**
 * Entry point for auto-checkpointing after events and artifact writes.
 * Called from emit-event and artifact-manager handlers.
 *
 * Returns the checkpoint file path if saved, null if skipped
 * (skips if no meaningful progress was made).
 */
export function autoCheckpoint(
  projectRoot: string,
  skill: string,
  goal: string,
): string | null {
  const checkpoint = buildCheckpoint(projectRoot, skill, goal);
  if (!checkpoint) return null;

  const path = saveCheckpoint(projectRoot, checkpoint);
  return path;
}

// ─── Loop Checkpoint Operations ───────────────────────────────

export interface LoopVerdict {
  passed: boolean;
  reason: string;
  tokensUsed: number;
  fixableByRetry: boolean;
}

export interface LoopCheckpoint {
  ts: string;
  trace_id: string;
  iteration: number;
  verdict: LoopVerdict;
  files_changed: string[];
}

function getLoopCheckpointDir(projectRoot: string): string {
  const dir = resolve(projectRoot, ".ritsu", CHECKPOINT_DIR, "loops");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Save a loop iteration checkpoint.
 */
export function saveLoopCheckpoint(
  projectRoot: string,
  traceId: string,
  iteration: number,
  verdict: LoopVerdict,
  filesChanged: string[] = [],
): string {
  const dir = getLoopCheckpointDir(projectRoot);
  const checkpoint: LoopCheckpoint = {
    ts: new Date().toISOString(),
    trace_id: traceId,
    iteration,
    verdict,
    files_changed: filesChanged,
  };
  const filename = `loop-cp-${traceId}-${iteration}.json`;
  const filepath = resolve(dir, filename);
  writeFileSync(filepath, JSON.stringify(checkpoint, null, 2), "utf-8");
  return filepath;
}

/**
 * Load all loop checkpoints for a trace.
 */
export function loadLoopHistory(
  projectRoot: string,
  traceId: string,
): LoopCheckpoint[] {
  const dir = getLoopCheckpointDir(projectRoot);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith(`loop-cp-${traceId}-`) && f.endsWith(".json"))
      .map((f) => {
        try {
          const content = readFileSync(resolve(dir, f), "utf-8");
          return JSON.parse(content) as LoopCheckpoint;
        } catch {
          return null;
        }
      })
      .filter((cp): cp is LoopCheckpoint => cp !== null)
      .sort((a, b) => a.iteration - b.iteration);
  } catch {
    return [];
  }
}

