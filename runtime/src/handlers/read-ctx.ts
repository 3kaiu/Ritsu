import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "node:fs";
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

  // Track unique correlation_ids for task counting
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

export async function ritsu_read_ctx(): Promise<CallToolResult> {
  const root = getProjectRoot();
  const ctxPath = getCtxPath(root);

  const data: Record<string, unknown> = {
    last_incomplete: null,
    last_completed: null,
    recent_entries: [],
    pending_approvals: [],
  };

  if (!existsSync(ctxPath)) {
    return warnResult(data, "ctx file does not exist yet — no events recorded");
  }

  data.last_incomplete = readLastIncomplete(root);
  data.last_completed = readLastCompleted(root);
  data.recent_entries = readRecentEntries(root, 10);
  data.pending_approvals = (
    data.recent_entries as Record<string, unknown>[]
  ).filter((e) => e.status === "approval_required");

  if ((data.recent_entries as Record<string, unknown>[]).length === 0) {
    return warnResult(
      data,
      "ctx file is empty — no events recorded this month",
    );
  }

  // 月度摘要 — 当记录超过阈值时自动计算并附加
  const allEntries = readAllEntries(root);
  if (allEntries.length >= SUMMARY_THRESHOLD) {
    data.summary = computeSummary(allEntries);
  }

  return textResult(JSON.stringify(data));
}
