import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ritsu_read_ctx } from "../handlers/read-ctx.js";
import { ritsu_read_agents } from "../handlers/read-agents.js";
import { ritsu_get_changed_files } from "../handlers/get-changed-files.js";
import { ritsu_list_artifacts } from "../handlers/list-artifacts.js";
import { ritsu_join_trace } from "../handlers/join-trace.js";
import { ritsu_exec } from "../handlers/exec.js";
import { syncOpenSpecContracts } from "../openspec-bridge.js";
import { inspectDiff } from "./diff-inspect.js";
import { runPolicyPreflight } from "./policy-preflight.js";
import {
  loadViolationRecords,
  findSimilarViolations,
} from "../similar-violations.js";
import type { PolicyPreflightResult } from "./policy-preflight.js";
import {
  runSuperpowersBrainstorming,
  fetchCodeGraphContext,
  getToolReadiness,
} from "./internal-tools.js";
import { buildArchitectureFingerprint, storeArchitectureFingerprint, buildArchitectureReport, buildArchitectureContext } from "./architecture-analyzer.js";

export type PreflightStage = "think" | "dev" | "hunt" | "review";
export type PreflightTier = "P0" | "P1" | "P2";

export type PreflightRunOptions = {
  projectRoot: string;
  stage: PreflightStage;
  tier?: PreflightTier;
  taskSummary?: string;
};

export type PreflightContextPack = Record<string, unknown> & {
  stage: PreflightStage;
  passed: boolean;
  next_skill?: string;
  /** Available internal tools (auto-detected) */
  _tools?: { superpowers: boolean; codegraph: boolean; openspec: boolean; native: boolean };
  /** CodeGraph graph context (auto-fetched when available) */
  _codegraph?: { symbols: string[]; files: string[] } | null;
  /** Architecture context (learned during think preflight) */
  _architecture?: Record<string, unknown>;
  /** Architecture drift violations (detected during dev/review preflight) */
  _architecture_drift?: import("./architecture-analyzer.js").LayerRule[];
  /** AI-readable action summary — 读这个就知道下一步该干什么 */
  _ai_summary?: string;
};

function inferTier(
  requested: PreflightTier | undefined,
  ctx: Record<string, unknown> | null,
): PreflightTier {
  if (requested) return requested;
  const recovery = ctx?.recovery_context;
  if (typeof recovery === "object" && recovery !== null) {
    const risk = (recovery as Record<string, unknown>).risk_level;
    if (risk === "critical") return "P2";
    if (risk === "standard") return "P1";
  }
  return "P1";
}

async function readCtxCompact(projectRoot: string): Promise<Record<string, unknown> | null> {
  process.env.RITSU_PROJECT_ROOT = projectRoot;
  const res = await ritsu_read_ctx({ detail: false });
  const text = res.content[0];
  if (!text || text.type !== "text") return null;
  try {
    return JSON.parse(text.text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function runThinkPreflight(
  projectRoot: string,
  tier: PreflightTier,
  taskSummary: string,
): Promise<PreflightContextPack> {
  const pack: PreflightContextPack = { stage: "think", tier, passed: true };

  pack.ctx = await readCtxCompact(projectRoot);
  process.env.RITSU_PROJECT_ROOT = projectRoot;
  const agentsRes = await ritsu_read_agents({});
  const agentsText = agentsRes.content[0];
  if (agentsText?.type === "text") {
    try {
      pack.agents = JSON.parse(agentsText.text) as Record<string, unknown>;
    } catch {
      pack.agents = null;
    }
  }

  // Auto-detect and report available internal tools
  pack._tools = getToolReadiness(projectRoot);

  // Internal: call Superpowers brainstorming if available
  if (taskSummary && pack._tools.superpowers) {
    const brainstorming = runSuperpowersBrainstorming(taskSummary);
    if (brainstorming.ok) {
      pack._brainstorming = brainstorming.requirements;
    }
  }

  // 架构漂移检测：学习当前项目的架构指纹
  try {
    const fingerprint = buildArchitectureFingerprint(projectRoot);
    storeArchitectureFingerprint(fingerprint);
    pack._architecture = buildArchitectureContext(fingerprint);
  } catch { /* non-critical */ }

  const hasOpenSpec = existsSync(resolve(projectRoot, "openspec"));

  if (tier === "P2" && taskSummary) {
    if (!hasOpenSpec) {
      await ritsu_exec({
        command: "npx --yes @fission-ai/openspec@latest init",
        timeout_ms: 120_000,
      });
    }
    const safeSummary = taskSummary
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80);
    await ritsu_exec({
      command: `npx --yes @fission-ai/openspec@latest propose ${safeSummary || "ritsu-change"}`,
      timeout_ms: 120_000,
    });
    const sync = syncOpenSpecContracts(projectRoot);
    if (!("error" in sync)) pack.openspec_sync = sync;
  } else if (hasOpenSpec) {
    const sync = syncOpenSpecContracts(projectRoot);
    if (!("error" in sync)) pack.openspec_sync = sync;
  }

  pack.next_skill = "dev";

  // AI summary
  const ctx = pack.ctx as Record<string, unknown> | null | undefined;
  const stageStr = `Stage: think (${tier})`;
  const ctxStr = ctx?.recovery_context ? `Resuming: ${(ctx.recovery_context as Record<string, unknown>).resume_hint ?? "incomplete task"}` : "New task";
  const archStr = pack._architecture ? `Architecture: ${(pack._architecture as Record<string, unknown>).modules ?? "scanning"}` : "";
  pack._ai_summary = [stageStr, ctxStr, archStr].filter(Boolean).join(" | ");

  return pack;
}

async function runDevReviewPreflight(
  projectRoot: string,
  stage: "dev" | "review",
  skill: string,
): Promise<PreflightContextPack> {
  const pack: PreflightContextPack = { stage, passed: true };

  pack.ctx = await readCtxCompact(projectRoot);
  process.env.RITSU_PROJECT_ROOT = projectRoot;

  const artifactsRes = await ritsu_list_artifacts({
    type: stage === "dev" ? "design-sheet" : "all",
  });
  const artText = artifactsRes.content[0];
  if (artText?.type === "text") {
    try {
      pack.artifacts = JSON.parse(artText.text) as Record<string, unknown>;
    } catch {
      pack.artifacts = null;
    }
  }

  const changedRes = await ritsu_get_changed_files({});
  const chText = changedRes.content[0];
  let changed: Record<string, unknown> | null = null;
  if (chText?.type === "text") {
    try {
      changed = JSON.parse(chText.text) as Record<string, unknown>;
    } catch {
      changed = null;
    }
  }
  pack.changed_files = changed;

  // Internal: auto-fetch CodeGraph context for affected symbols
  const codegraphFiles = changed?.files;
  if (Array.isArray(codegraphFiles)) {
    const cg = fetchCodeGraphContext(codegraphFiles.filter((f): f is string => typeof f === "string"));
    if (cg.symbols.length > 0) pack._codegraph = cg;
  }

  // 架构漂移检测
  try {
    if (Array.isArray(codegraphFiles)) {
      const { checkArchitectureDrift } = await import("./architecture-analyzer.js");
      const driftViolations = checkArchitectureDrift(
        codegraphFiles.filter((f: unknown): f is string => typeof f === "string"),
        projectRoot,
      );
      if (driftViolations.length > 0) {
        pack._architecture_drift = driftViolations;
      }
    }
  } catch { /* non-critical */ }

  const statDiff = await inspectDiff({
    projectRoot,
    mode: "stat",
  });
  if (statDiff.ok) {
    pack.diff = {
      files: statDiff.data.files,
      truncated: false,
    };
  }

  const policy: PolicyPreflightResult = await runPolicyPreflight(projectRoot, skill);
  pack.policy = {
    passed: policy.passed,
    violations: policy.violations,
    scan_files: policy.scan_files,
    cached: policy.cached,
  };
  pack.passed = policy.passed;

  if (stage === "review") {
    const ctx = pack.ctx as Record<string, unknown> | null | undefined;
    const lastIncomplete = ctx?.last_incomplete as Record<string, unknown> | undefined;
    const traceId =
      typeof lastIncomplete?.trace_id === "string" ? lastIncomplete.trace_id : undefined;
    if (traceId) {
      const traceRes = await ritsu_join_trace({ trace_id: traceId });
      const tText = traceRes.content[0];
      if (tText?.type === "text") {
        try {
          pack.trace = JSON.parse(tText.text) as Record<string, unknown>;
        } catch {
          pack.trace = null;
        }
      }
    }
    pack.triple_check_hint =
      "Verify design.contracts ↔ dev.gates ↔ assurance.verdict before PASS";
  }

  pack.next_skill = pack.passed
    ? stage === "dev"
      ? "review"
      : "close_span"
    : stage;

  const ctx = pack.ctx as Record<string, unknown> | null | undefined;
  const passStr = pack.passed ? "Policy: passed" : "Policy: violations found";
  const driftStr = pack._architecture_drift ? `Architecture drift: ${pack._architecture_drift.length} issues` : "";
  pack._ai_summary = [`Stage: ${stage}`, passStr, driftStr].filter(Boolean).join(" | ");

  return pack;
}

async function runHuntPreflight(projectRoot: string): Promise<PreflightContextPack> {
  const pack: PreflightContextPack = { stage: "hunt", passed: true };

  const ctx = await readCtxCompact(projectRoot);
  pack.ctx = ctx;
  pack.recovery_context = ctx?.recovery_context ?? null;

  process.env.RITSU_PROJECT_ROOT = projectRoot;
  const changedRes = await ritsu_get_changed_files({});
  const chText = changedRes.content[0];
  if (chText?.type === "text") {
    try {
      pack.changed_files = JSON.parse(chText.text) as Record<string, unknown>;
    } catch {
      pack.changed_files = null;
    }
  }

  const chunks = await inspectDiff({ projectRoot, mode: "chunks", topN: 15 });
  if (chunks.ok && Array.isArray(chunks.data.chunks)) {
    pack.top_risk_chunks = chunks.data.chunks;
  }

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
  pack.similar_violations = findSimilarViolations(
    loadViolationRecords(resolve(projectRoot, ".ritsu"), since),
    "failure error regression",
    8,
  );

  pack.next_skill = "dev";

  const ctx = pack.ctx as Record<string, unknown> | null | undefined;
  const cv = (pack.similar_violations as Array<Record<string, unknown>> | undefined)?.length ?? 0;
  const recovery = ctx?.recovery_context ? `Recovery: ${(ctx.recovery_context as Record<string, unknown>).resume_hint ?? "available"}` : "";
  pack._ai_summary = [`Stage: hunt`, `Similar violations found: ${cv}`, recovery].filter(Boolean).join(" | ");

  return pack;
}

export async function runStagePreflight(
  options: PreflightRunOptions,
): Promise<PreflightContextPack> {
  const { projectRoot, stage, taskSummary = "" } = options;

  if (stage === "think") {
    const ctx = await readCtxCompact(projectRoot);
    const tier = inferTier(options.tier, ctx);
    return runThinkPreflight(projectRoot, tier, taskSummary);
  }
  if (stage === "hunt") return runHuntPreflight(projectRoot);
  if (stage === "dev") return runDevReviewPreflight(projectRoot, "dev", "dev");
  return runDevReviewPreflight(projectRoot, "review", "review");
}
