import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { ritsu_read_ctx } from "../handlers/read-ctx.js";
import { detectSuperpowersPhase } from "./superpowers-bridge.js";
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

/**
 * Optional CodeGraph context fetch for preflight enrichment.
 * Gracefully skips if CodeGraph is not installed.
 */
function tryFetchCodeGraphContext(changedFiles?: Record<string, unknown> | null): Record<string, unknown> | null {
  try {
    execFileSync("which", ["codegraph"], { stdio: "ignore" });
  } catch {
    return null;
  }

  const files = changedFiles?.files;
  if (!Array.isArray(files) || files.length === 0) return null;

  const filePaths = files.filter((f): f is string => typeof f === "string").slice(0, 10);
  if (filePaths.length === 0) return null;

  try {
    const output = execFileSync("codegraph", ["affected", "--json", ...filePaths], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    }).toString().trim();
    const parsed = JSON.parse(output) as Record<string, unknown>;
    return parsed;
  } catch {
    return null;
  }
}

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
  /** Optional CodeGraph context — present when codegraph CLI is available */
  codegraph?: Record<string, unknown> | null;
  /** When Superpowers is detected, the active Superpowers phase */
  superpowers_phase?: string | null;
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

  // Optional CodeGraph context enhancement
  pack.codegraph = tryFetchCodeGraphContext(changed);

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
  return pack;
}

export async function runStagePreflight(
  options: PreflightRunOptions,
): Promise<PreflightContextPack> {
  const { projectRoot, stage, taskSummary = "" } = options;

  // Detect if running inside Superpowers workflow
  const sp = detectSuperpowersPhase(projectRoot);
  if (sp.hasSuperpowers) {
    console.error(`[ritsu-preflight] Superpowers detected, phase=${sp.currentPhase ?? "unknown"}, routing to Ritsu stage=${sp.ritsuStage}`);
  }

  // When Superpowers is active, the context_pack includes its phase info
  if (stage === "think") {
    const ctx = await readCtxCompact(projectRoot);
    const tier = inferTier(options.tier, ctx);
    const pack = await runThinkPreflight(projectRoot, tier, taskSummary);
    if (sp.hasSuperpowers) pack.superpowers_phase = sp.currentPhase;
    return pack;
  }
  if (stage === "hunt") return runHuntPreflight(projectRoot);
  if (stage === "dev") {
    const pack = await runDevReviewPreflight(projectRoot, "dev", "dev");
    if (sp.hasSuperpowers) pack.superpowers_phase = sp.currentPhase;
    return pack;
  }
  const pack = await runDevReviewPreflight(projectRoot, "review", "review");
  if (sp.hasSuperpowers) pack.superpowers_phase = sp.currentPhase;
  return pack;
}
