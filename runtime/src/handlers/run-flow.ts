import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { runFlowBySelection } from "../flow-runtime.js";
import { errorResult, textResult } from "./_utils.js";

export async function ritsu_run_flow(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  try {
    const inputContext =
      params.input_context &&
      typeof params.input_context === "object" &&
      !Array.isArray(params.input_context)
        ? (params.input_context as Record<string, unknown>)
        : undefined;

    const state = await runFlowBySelection(
      {
        flow_id: params.flow_id ? String(params.flow_id) : undefined,
        phase: params.phase ? String(params.phase) : undefined,
        intent: params.intent ? String(params.intent) : undefined,
      },
      {
        input_context: inputContext,
        stop_before_ai: params.stop_before_ai !== false,
        dry_run: params.dry_run === true,
      },
    );

    return textResult(JSON.stringify(state));
  } catch (error: any) {
    return errorResult(error.message);
  }
}
