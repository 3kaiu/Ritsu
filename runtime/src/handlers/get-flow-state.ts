import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getLatestFlowState, readFlowState } from "../flow-runtime.js";
import { errorResult, textResult } from "./_utils.js";

export async function ritsu_get_flow_state(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const runId = params.run_id ? String(params.run_id) : "";
  const state = runId ? readFlowState(runId) : getLatestFlowState();
  if (!state) {
    return errorResult(runId ? `flow state not found: ${runId}` : "no flow state found");
  }
  return textResult(JSON.stringify(state));
}
