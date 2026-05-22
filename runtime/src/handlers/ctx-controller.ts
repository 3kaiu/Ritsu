import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  readRecentEntries,
  readLastCompleted,
  readLastIncomplete,
  readAllEntries,
} from "../ctx-reader.js";
import { getCtxPath } from "../ctx-path.js";
import { getStageForSkill } from "../shared.js";
import { getProjectRoot, textResult, warnResult, errorResult } from "./_utils.js";
import { verifyEvent, getOrCreateKey } from "../policy/signature.js";

// ─── read-ctx constants ───

const SUMMARY_THRESHOLD = 50;
const PRUNED_RECENT_LIMIT = 10;

function attachStage(entry: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!entry) return null;
  const skill = String(entry.skill ?? "");
  const copy: Record<string, unknown> = { ...entry, stage: getStageForSkill(skill) };
  delete copy.signature;
  return copy;
}

function attachStageToEntries(entries: Record<string, unknown>[]): Record<string, unknown>[] {
  return entries.map((entry) => attachStage(entry) ?? entry);
}

function computeSummary(entries: Record<string, unknown>[]): Record<string, unknown> | null {
  if (entries.length === 0) return null;

  const skillsUsed: Record<string, number> = {};
  const domains: Record<string, number> = {};
  const taskTerminalStatus = new Map<string, "done" | "failed" | null>();

  for (const e of entries) {
    const skill = String(e.skill ?? "unknown");
    const domain = String(e.domain ?? "unknown");
    skillsUsed[skill] = (skillsUsed[skill] ?? 0) + 1;
    domains[domain] = (domains[domain] ?? 0) + 1;

    const cid = String(e.correlation_id ?? "");
    if (cid) {
      if (!taskTerminalStatus.has(cid)) taskTerminalStatus.set(cid, null);
      if (e.status === "done" || e.status === "failed") taskTerminalStatus.set(cid, e.status);
    }
  }

  let tasksDone = 0, tasksFailed = 0;
  for (const status of taskTerminalStatus.values()) {
    if (status === "done") tasksDone++;
    if (status === "failed") tasksFailed++;
  }

  return {
    month: new Date().toISOString().slice(0, 7),
    tasks_total: taskTerminalStatus.size,
    tasks_done: tasksDone,
    tasks_failed: tasksFailed,
    skills_used: skillsUsed,
    domains,
  };
}

function statusWeight(status: string): number {
  if (status === "artifact_written") return 4;
  if (status === "done") return 3;
  if (status === "started") return 2;
  if (status === "failed") return 1;
  return 0;
}

function pruneRecentEntries(
  entries: Record<string, unknown>[],
  limit: number,
  lastIncompleteCid?: string | null,
  lastCompletedCid?: string | null,
): Record<string, unknown>[] {
  if (entries.length <= limit) return entries;

  const scored = entries.map((e, idx) => {
    const s = String(e.status ?? "");
    const cid = String(e.correlation_id ?? "");
    let w = statusWeight(s);
    if (cid && (cid === lastIncompleteCid || cid === lastCompletedCid)) w += 10;
    const recency = idx / Math.max(1, entries.length - 1);
    return { e, score: w + recency, idx };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.e);
}

function summarizeFailedEntries(entries: Record<string, unknown>[]): Record<string, unknown> {
  const bySkill: Record<string, { count: number; last_error: string; last_ts: string; last_cid: string }> = {};
  for (const e of entries) {
    if (e.status !== "failed") continue;
    const skill = String(e.skill ?? "unknown");
    const ts = String(e.ts ?? "");
    const cid = String(e.correlation_id ?? "");
    const err = String(e.error ?? "");
    const cur = bySkill[skill] ?? { count: 0, last_error: "", last_ts: "", last_cid: "" };
    cur.count++;
    if (!cur.last_ts || ts > cur.last_ts) {
      cur.last_ts = ts;
      cur.last_error = err;
      cur.last_cid = cid;
    }
    bySkill[skill] = cur;
  }
  const totalFailed = Object.values(bySkill).reduce((a, b) => a + b.count, 0);
  return { total_failed: totalFailed, by_skill: bySkill };
}

function checkRealityDesync(
  root: string,
  lastCompleted: Record<string, unknown> | null,
  entries: Record<string, unknown>[],
): { desync_detected: boolean; missing_artifacts: string[] } {
  const missing: string[] = [];
  if (!lastCompleted) return { desync_detected: false, missing_artifacts: missing };

  const artifacts = new Set<string>();
  const addArtifact = (value: unknown) => {
    const artifact = String(value ?? "");
    if (artifact && artifact !== "null") artifacts.add(artifact);
  };

  addArtifact(lastCompleted.artifact);
  const cid = String(lastCompleted.correlation_id ?? "");
  if (cid) {
    for (const entry of entries) {
      if (String(entry.correlation_id ?? "") !== cid) continue;
      if (entry.status === "artifact_written") addArtifact(entry.artifact);
    }
  }

  for (const artifact of artifacts) {
    const fullPath = resolve(root, artifact);
    if (!existsSync(fullPath)) missing.push(artifact);
  }

  return { desync_detected: missing.length > 0, missing_artifacts: missing };
}

function computeCircuitBreaker(entries: Record<string, unknown>[]): {
  consecutive_fails: number;
  should_redirect: string | null;
  recommended_stage: string | null;
  last_failed_skill: string | null;
  last_failed_cid: string | null;
} {
  const cidGroups: Record<string, Record<string, unknown>[]> = {};
  for (const e of entries) {
    const cid = String(e.correlation_id ?? "");
    if (cid) {
      if (!cidGroups[cid]) cidGroups[cid] = [];
      cidGroups[cid].push(e);
    }
  }

  let lastFailedCid: string | null = null;
  let lastFailedSkill: string | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].status === "failed") {
      lastFailedCid = String(entries[i].correlation_id ?? "");
      lastFailedSkill = String(entries[i].skill ?? "");
      break;
    }
  }

  if (!lastFailedCid || !cidGroups[lastFailedCid]) {
    return { consecutive_fails: 0, should_redirect: null, recommended_stage: null, last_failed_skill: null, last_failed_cid: null };
  }

  const group = cidGroups[lastFailedCid];
  let consecutiveFails = 0;
  for (let i = group.length - 1; i >= 0; i--) {
    if (group[i].status === "failed") consecutiveFails++;
    else if (group[i].status === "done") break;
  }

  return {
    consecutive_fails: consecutiveFails,
    should_redirect: consecutiveFails >= 2 ? "think" : null,
    recommended_stage: consecutiveFails >= 2 ? getStageForSkill("think") : null,
    last_failed_skill: lastFailedSkill,
    last_failed_cid: lastFailedCid,
  };
}

function buildRecoveryContext(
  lastIncomplete: Record<string, unknown> | null,
  lastCompleted: Record<string, unknown> | null,
  entries: Record<string, unknown>[],
): Record<string, unknown> | null {
  if (!lastIncomplete) return null;

  const skill = String(lastIncomplete.skill ?? "");
  const cid = String(lastIncomplete.correlation_id ?? "");
  const domain = String(lastIncomplete.domain ?? "");
  const step = String(lastIncomplete.step ?? "");
  const stage = getStageForSkill(skill);

  let lastArtifact: string | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (String(e.correlation_id ?? "") === cid && e.status === "artifact_written" && e.artifact) {
      lastArtifact = String(e.artifact);
      break;
    }
  }

  return {
    skill, stage, domain, step, correlation_id: cid, last_artifact: lastArtifact,
    resume_hint: `🔄 会话恢复: ${stage} (${skill}) | 断点: step ${step} | 领域: ${domain}${lastArtifact ? ` | 产物: ${lastArtifact}` : ""}`,
  };
}

function computeNextStepAndBreakpoint(
  root: string,
  lastIncomplete: Record<string, unknown> | null,
  lastCompleted: Record<string, unknown> | null,
  _allEntries: Record<string, unknown>[],
): { recommended_next_step: string | null; breakpoint_summary: string | null } {
  if (lastIncomplete) {
    const skill = String(lastIncomplete.skill ?? "");
    const stage = getStageForSkill(skill);
    return { recommended_next_step: `/r-${skill}`, breakpoint_summary: `检测到未完成的任务：${stage} (${skill})。建议继续执行。` };
  }

  if (!lastCompleted) {
    return { recommended_next_step: "/r-init", breakpoint_summary: "项目尚未初始化或无历史记录。建议从 /r-init 开始。" };
  }

  const lastSkill = String(lastCompleted.skill ?? "");
  const lastStage = getStageForSkill(lastSkill);

  const stateMap: Record<string, { next: string | null; summary: string }> = {
    init: { next: "/r-think", summary: "项目已初始化。可以开始需求分析 (/r-think)。" },
    think: { next: "/r-dev", summary: "《设计单 (Design Sheet)》已完成。建议开始开发 (/r-dev)。" },
    dev: { next: "/r-review", summary: "代码实现已完成。建议进行验收审查 (/r-review)。" },
    review: { next: null, summary: "上一次验收已完成。所有交付已闭环。" },
  };

  const recommendation = stateMap[lastStage] ?? { next: null, summary: `上一次任务 (${lastStage}) 已完成。` };
  return { recommended_next_step: recommendation.next, breakpoint_summary: recommendation.summary };
}

// ─── Read Context ───

export async function ritsu_read_ctx(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const ctxPath = getCtxPath(root);
  const isDetail = !!params.detail;
  const tokenBudget = typeof params.token_budget === "number" ? params.token_budget : 2000;

  const data: Record<string, unknown> = {
    last_incomplete: null,
    last_completed: null,
    recent_entries: [],
    recovery_context: null,
    reality_check: null,
    circuit_breaker_status: null,
  };

  if (!existsSync(ctxPath)) {
    return warnResult(data, "ctx file does not exist yet — no events recorded");
  }

  const ctxStats = existsSync(ctxPath) ? statSync(ctxPath) : null;
  const useTailRead = !isDetail && ctxStats && ctxStats.size > 256 * 1024;

  const allEntries = useTailRead ? readRecentEntries(root, 50) : readAllEntries(root);
  const lastIncomplete = readLastIncomplete(root);
  const lastCompleted = readLastCompleted(root);
  const recentEntries = readRecentEntries(root, 10);
  const failedSummary = summarizeFailedEntries(allEntries);

  if (tokenBudget !== undefined && tokenBudget < 1000) {
    data.recovery_context = buildRecoveryContext(lastIncomplete, lastCompleted, allEntries);
    data.circuit_breaker_status = computeCircuitBreaker(allEntries);
    const nextStep = computeNextStepAndBreakpoint(root, lastIncomplete, lastCompleted, allEntries);
    data.recommended_next_step = nextStep.recommended_next_step;
    data.breakpoint_summary = nextStep.breakpoint_summary;
    data._budget = "low";
    return textResult(JSON.stringify(data));
  }

  data.last_incomplete = attachStage(lastIncomplete);
  data.last_completed = attachStage(lastCompleted);
  data.recent_entries = attachStageToEntries(recentEntries);

  if (isDetail || (tokenBudget !== undefined && tokenBudget > 5000)) {
    const recentEntriesPruned = pruneRecentEntries(
      allEntries, PRUNED_RECENT_LIMIT,
      lastIncomplete?.correlation_id as string,
      lastCompleted?.correlation_id as string,
    );
    data.recent_entries_pruned = attachStageToEntries(recentEntriesPruned);
    data.failed_summary = failedSummary;
    data._budget = "high";
  } else {
    data.failed_count = failedSummary.total_failed;
    if (tokenBudget !== undefined) data._budget = "medium";
  }

  data.recovery_context = buildRecoveryContext(lastIncomplete, lastCompleted, allEntries);
  data.reality_check = checkRealityDesync(root, lastCompleted, allEntries);

  const cbStatus = computeCircuitBreaker(allEntries);
  data.circuit_breaker_status = cbStatus;

  const nextStep = computeNextStepAndBreakpoint(root, lastIncomplete, lastCompleted, allEntries);

  if (cbStatus.should_redirect) {
    data.recommended_next_step = `/r-${cbStatus.should_redirect}`;
    data.breakpoint_summary = `检测到连续失败，建议回流至 ${cbStatus.should_redirect} 阶段重新分析。`;
  } else {
    data.recommended_next_step = nextStep.recommended_next_step;
    data.breakpoint_summary = nextStep.breakpoint_summary;
  }

  if (recentEntries.length === 0) {
    return warnResult(data, "ctx file is empty — no events recorded this month");
  }

  if (allEntries.length >= SUMMARY_THRESHOLD) {
    data.summary = computeSummary(allEntries);
  }

  return textResult(JSON.stringify(data));
}

// ─── Verify Trace ───

export async function ritsu_verify_trace(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const traceId = String(params.trace_id ?? "");
  const key = getOrCreateKey();

  if (!key) {
    return errorResult("No trust key found. Use ritsu_init_trust_key first.");
  }

  const entries = readAllEntries(root);
  const traceEvents = entries.filter((e) => e.trace_id === traceId);

  if (traceEvents.length === 0) {
    return errorResult(`trace not found: ${traceId}`);
  }

  let violationCount = 0;
  const details = traceEvents.map(e => {
    const valid = verifyEvent(e, key);
    if (!valid) violationCount++;
    return { span_id: e.span_id, status: e.status, valid };
  });

  return textResult(JSON.stringify({
    trace_id: traceId,
    valid: violationCount === 0,
    violation_count: violationCount,
    details,
  }));
}
