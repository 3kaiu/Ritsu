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
import { getProjectRoot, textResult, warnResult } from "./_utils.js";

const SUMMARY_THRESHOLD = 50;

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

  return {
    consecutive_fails: consecutiveFails,
    should_redirect: shouldRedirect,
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
    domain,
    step,
    correlation_id: cid,
    last_artifact: lastArtifact,
    resume_hint: `🔄 会话恢复: /r-${skill} | 断点: step ${step} | 领域: ${domain}${lastArtifact ? ` | 产物: ${lastArtifact}` : ""}`,
  };
}

export async function ritsu_read_ctx(): Promise<CallToolResult> {
  const root = getProjectRoot();
  const ctxPath = getCtxPath(root);

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

  data.last_incomplete = lastIncomplete;
  data.last_completed = lastCompleted;
  data.recent_entries = recentEntries;

  data.recovery_context = buildRecoveryContext(
    lastIncomplete,
    lastCompleted,
    allEntries,
  );

  data.reality_check = checkRealityDesync(root, lastCompleted);

  data.circuit_breaker_status = computeCircuitBreaker(allEntries);

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
