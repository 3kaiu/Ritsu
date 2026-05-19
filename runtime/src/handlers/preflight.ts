import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { runStagePreflight, type PreflightStage } from "../orchestration/preflight-runner.js";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";

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
  });

  const body = { ok: contextPack.passed !== false, context_pack: contextPack };

  if (contextPack.passed === false) {
    return {
      content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
      isError: true,
    };
  }
  return textResult(JSON.stringify(body, null, 2));
}
