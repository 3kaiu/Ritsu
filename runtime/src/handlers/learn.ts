import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";
import { autoApplyMinedRules, extractHeuristicRules } from "../miner.js";

function getDays(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 90) : 7;
}

export async function ritsu_learn(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const days = getDays(params.days);

  try {
    const result = await autoApplyMinedRules(days);

    if (result.addedCount === 0) {
      return textResult(JSON.stringify({
        learned: false,
        message: "No new preference patterns detected in the last " + days + " days.",
        added_count: 0,
      }));
    }

    const ruleSummary = result.rules.map((r) => ({
      id: r.id,
      scope: r.scope ?? "unknown",
      message: r.message ?? "",
    }));

    return textResult(JSON.stringify({
      learned: true,
      added_count: result.addedCount,
      rules: ruleSummary,
      message: `${result.addedCount} new preference rule(s) learned and applied to .ritsu/preferences.yaml`,
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(`ritsu_learn failed: ${message}`);
  }
}
