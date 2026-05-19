import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { inspectDiff, type InspectDiffMode } from "../orchestration/diff-inspect.js";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";

function parseMode(value: unknown): InspectDiffMode {
  const m = String(value ?? "full").toLowerCase();
  if (m === "stat" || m === "chunks" || m === "full") return m;
  return "full";
}

export async function ritsu_inspect_diff(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const result = await inspectDiff({
    projectRoot: root,
    mode: parseMode(params.mode),
    cached: params.cached === true,
    maxOutputLines: Number(params.max_output_lines ?? 500),
    topN: Number(params.top_n ?? 20),
  });
  if (!result.ok) return errorResult(result.error);
  return textResult(JSON.stringify(result.data, null, 2));
}

/** @deprecated Use ritsu_inspect_diff mode=full */
export async function ritsu_get_diff(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  return ritsu_inspect_diff({ ...params, mode: "full" });
}

/** @deprecated Use ritsu_inspect_diff mode=chunks */
export async function ritsu_diff_chunks(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  return ritsu_inspect_diff({ ...params, mode: "chunks" });
}
