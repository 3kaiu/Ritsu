import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  readRecentEntries,
  readLastCompleted,
  readLastIncomplete,
  readAllEntries,
} from "../ctx-reader.js";
import { getCtxPath } from "../ctx-path.js";
import { getStageForSkill } from "../shared.js";
import { getProjectRoot, textResult, warnResult } from "./_utils.js";

const SUMMARY_THRESHOLD = 50;

const PRUNED_RECENT_LIMIT = 10;

function attachStage(
  entry: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!entry) return null;
  const skill = String(entry.skill ?? "");
  return {
    ...entry,
    stage: getStageForSkill(skill),
  };
}

function attachStageToEntries(
  entries: Record<string, unknown>[],
): Record<string, unknown>[] {
  return entries.map((entry) => attachStage(entry) ?? entry);
}

function computeSummary(
  entries: Record<string, unknown>[],
): Record<string, unknown> | null {
  if (entries.length === 0) return null;

  const skillsUsed: Record<string, number> = {};
  const domains: Record<string, number> = {};
  let tasksTotal = 0;
  let tasksDone = 0;
  let tasksFailed = 0;

  const seenCids = new Set<string>();

  for (const e of entries) {
    const skill = String(e.skill ?? "unknown");
    const domain = String(e.domain ?? "unknown");
    skillsUsed[skill] = (skillsUsed[skill] ?? 0) + 1;
    domains[domain] = (domains[domain] ?? 0) + 1;

    const cid = String(e.correlation_id ?? "");
    if (cid && !seenCids.has(cid)) {
      seenCids.add(cid);
      tasksTotal++;
      if (e.status === "done") tasksDone++;
      if (e.status === "failed") tasksFailed++;
    }
  }

  const month = new Date().toISOString().slice(0, 7);
  return {
    month,
    tasks_total: tasksTotal,
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

  // Prefer important statuses, but keep recency: score = weight + recency bonus
  const scored = entries.map((e, idx) => {
    const s = String(e.status ?? "");
    const cid = String(e.correlation_id ?? "");
    let w = statusWeight(s);

    // Force inclusion of anchor points
    if (cid && (cid === lastIncompleteCid || cid === lastCompletedCid)) {
      w += 10; // Mega boost
    }

    // recency bonus: last entries get slightly higher
    const recency = idx / Math.max(1, entries.length - 1);
    const score = w + recency;
    return { e, score, idx };
  });

  const picked = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    // keep chronological order for readability
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.e);

  return picked;
}

function summarizeFailedEntries(
  entries: Record<string, unknown>[],
): Record<string, unknown> {
  const bySkill: Record<
    string,
    { count: number; last_error: string; last_ts: string; last_cid: string }
  > = {};

  for (const e of entries) {
    if (e.status !== "failed") continue;
    const skill = String(e.skill ?? "unknown");
    const ts = String(e.ts ?? "");
    const cid = String(e.correlation_id ?? "");
    const err = String(e.error ?? "");

    const cur = bySkill[skill] ?? {
      count: 0,
      last_error: "",
      last_ts: "",
      last_cid: "",
    };
    cur.count += 1;
    // keep last (most recent) failure info
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

// ─── 现实对账：检查 last_completed 的 artifact 是否仍存在 ───

function checkRealityDesync(
  root: string,
  lastCompleted: Record<string, unknown> | null,
): { desync_detected: boolean; missing_artifacts: string[] } {
  const missing: string[] = [];
  if (!lastCompleted)
    return { desync_detected: false, missing_artifacts: missing };

  const artifact = String(lastCompleted.artifact ?? "");
  if (artifact && artifact !== "null") {
    const fullPath = resolve(root, artifact);
    if (!existsSync(fullPath)) {
      missing.push(artifact);
    }
  }

  return {
    desync_detected: missing.length > 0,
    missing_artifacts: missing,
  };
}

// ─── 熔断状态计算：统计同一 correlation_id 下的连续 failed 次数 ───

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
    return {
      consecutive_fails: 0,
      should_redirect: null,
      recommended_stage: null,
      last_failed_skill: null,
      last_failed_cid: null,
    };
  }

  const group = cidGroups[lastFailedCid];
  let consecutiveFails = 0;
  for (let i = group.length - 1; i >= 0; i--) {
    if (group[i].status === "failed") {
      consecutiveFails++;
    } else if (group[i].status === "done") {
      break;
    }
  }

  const shouldRedirect = consecutiveFails >= 2 ? "think" : null;
  const recommendedStage = shouldRedirect
    ? getStageForSkill(shouldRedirect)
    : null;

  return {
    consecutive_fails: consecutiveFails,
    should_redirect: shouldRedirect,
    recommended_stage: recommendedStage,
    last_failed_skill: lastFailedSkill,
    last_failed_cid: lastFailedCid,
  };
}

// ─── 可操作恢复上下文 ───

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
    if (
      String(e.correlation_id ?? "") === cid &&
      e.status === "artifact_written" &&
      e.artifact
    ) {
      lastArtifact = String(e.artifact);
      break;
    }
  }

  return {
    skill,
    stage,
    domain,
    step,
    correlation_id: cid,
    last_artifact: lastArtifact,
    resume_hint: `🔄 会话恢复: ${stage} (${skill}) | 断点: step ${step} | 领域: ${domain}${lastArtifact ? ` | 产物: ${lastArtifact}` : ""}`,
  };
}

// ─── 智能下一步建议与断点对账 ───

function computeNextStepAndBreakpoint(
  root: string,
  lastIncomplete: Record<string, unknown> | null,
  lastCompleted: Record<string, unknown> | null,
  allEntries: Record<string, unknown>[],
): { recommended_next_step: string | null; breakpoint_summary: string | null } {
  if (lastIncomplete) {
    const skill = String(lastIncomplete.skill ?? "");
    const stage = getStageForSkill(skill);
    return {
      recommended_next_step: `/r-${skill}`,
      breakpoint_summary: `检测到未完成的任务：${stage} (${skill})。建议继续执行。`,
    };
  }

  if (!lastCompleted) {
    return {
      recommended_next_step: "/r-init",
      breakpoint_summary: "项目尚未初始化或无历史记录。建议从 /r-init 开始。",
    };
  }

  const lastSkill = String(lastCompleted.skill ?? "");
  const lastStage = getStageForSkill(lastSkill);

  const stateMap: Record<string, { next: string | null; summary: string }> = {
    init: {
      next: "/r-think",
      summary: "项目已初始化。可以开始需求分析 (/r-think)。",
    },
    think: {
      next: "/r-dev",
      summary: "《设计单 (Design Sheet)》已完成。建议开始开发 (/r-dev)。",
    },
    dev: {
      next: "/r-review",
      summary: "代码实现已完成。建议进行验收审查 (/r-review)。",
    },
    test: {
      next: "/r-review",
      summary: "测试验证已完成。建议进行最终验收 (/r-review)。",
    },
    review: {
      next: null,
      summary: "上一次验收已完成。所有交付已闭环。",
    },
  };

  const recommendation = stateMap[lastStage] ?? {
    next: null,
    summary: `上一次任务 (${lastStage}) 已完成。`,
  };

  return {
    recommended_next_step: recommendation.next,
    breakpoint_summary: recommendation.summary,
  };
}

export async function ritsu_read_ctx(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const ctxPath = getCtxPath(root);
  const isDetail = !!params.detail;

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

  const allEntries = readAllEntries(root);
  const lastIncomplete = readLastIncomplete(root);
  const lastCompleted = readLastCompleted(root);
  const recentEntries = readRecentEntries(root, 10);
  const failedSummary = summarizeFailedEntries(allEntries);

  data.last_incomplete = attachStage(lastIncomplete);
  data.last_completed = attachStage(lastCompleted);
  data.recent_entries = attachStageToEntries(recentEntries);

  if (isDetail) {
    const recentEntriesPruned = pruneRecentEntries(
      allEntries,
      PRUNED_RECENT_LIMIT,
      lastIncomplete?.correlation_id as string,
      lastCompleted?.correlation_id as string,
    );
    data.recent_entries_pruned = attachStageToEntries(recentEntriesPruned);
    data.failed_summary = failedSummary;
  } else {
    // 紧凑模式：只保留失败计数，不保留明细
    data.failed_count = failedSummary.total_failed;
  }

  data.recovery_context = buildRecoveryContext(
    lastIncomplete,
    lastCompleted,
    allEntries,
  );

  data.reality_check = checkRealityDesync(root, lastCompleted);

  data.circuit_breaker_status = computeCircuitBreaker(allEntries);

  const nextStep = computeNextStepAndBreakpoint(
    root,
    lastIncomplete,
    lastCompleted,
    allEntries,
  );

  // 优先级：熔断重定向 > 断点恢复 > 阶段建议
  if (data.circuit_breaker_status.should_redirect) {
    data.recommended_next_step = `/r-${data.circuit_breaker_status.should_redirect}`;
    data.breakpoint_summary = `检测到连续失败，建议回流至 ${data.circuit_breaker_status.should_redirect} 阶段重新分析。`;
  } else {
    data.recommended_next_step = nextStep.recommended_next_step;
    data.breakpoint_summary = nextStep.breakpoint_summary;
  }

  if (recentEntries.length === 0) {
    return warnResult(
      data,
      "ctx file is empty — no events recorded this month",
    );
  }

  if (allEntries.length >= SUMMARY_THRESHOLD) {
    data.summary = computeSummary(allEntries);
  }

  return textResult(JSON.stringify(data));
}
