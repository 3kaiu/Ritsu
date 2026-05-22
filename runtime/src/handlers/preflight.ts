import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { runStagePreflight, type PreflightStage } from "../orchestration/preflight-runner.js";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";
import { trimToBudget } from "../token-budget.js";

/** Preflight 响应 Token 预算（~1KB 动态后缀，缓存友好） */
const PREFLIGHT_BUDGET = 2000;

/** 字段优先级: 数字越小越优先保留 */
const PREFLIGHT_PRIORITY = [
  "ok",
  "_ai_summary",
  "stage",
  "passed",
  "next_skill",
  "ctx",
  "policy",
  "_architecture",
  "_architecture_drift",
  "_tools",
  "circuit_breaker_status",
  "changed_files",
  "_codegraph",
  "diff",
  "trace",
  "artifacts",
  "openspec_sync",
  "_brainstorming",
  "agents",
];

export async function ritsu_preflight(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const stage = String(params.stage ?? "") as PreflightStage;
  if (!["think", "dev", "hunt", "review"].includes(stage)) {
    return errorResult("stage must be think, dev, hunt, or review");
  }

  const root = getProjectRoot();
  const tierParam = params.tier;
  const tier =
    tierParam === "P0" || tierParam === "P1" || tierParam === "P2"
      ? tierParam
      : undefined;

  const contextPack = await runStagePreflight({
    projectRoot: root,
    stage,
    tier,
    taskSummary: typeof params.task_summary === "string" ? params.task_summary : "",
    detail: params.detail === true,
  });

  const body = { ok: contextPack.passed !== false, context_pack: contextPack };

  // Token Squeezer: 动态上下文超出预算时丢弃低优先级字段
  const trimmed = trimToBudget(body, PREFLIGHT_BUDGET, PREFLIGHT_PRIORITY);
  const result = trimmed === body ? body : { ...trimmed, _truncated: true };

  if (contextPack.passed === false) {
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: true,
    };
  }
  return textResult(JSON.stringify(result, null, 2));
}
