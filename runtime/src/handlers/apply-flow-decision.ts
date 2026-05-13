import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  applyFlowDecision,
  buildFlowDecisionErrorPayload,
  FlowDecisionContractError,
} from "../flow-runtime.js";
import { errorResult, jsonErrorResult, textResult } from "./_utils.js";

export async function ritsu_apply_flow_decision(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const runId = String(params.run_id ?? "");
  if (!runId) {
    return jsonErrorResult(
      buildFlowDecisionErrorPayload(
        [
          {
            code: "missing_run_id",
            severity: "error",
            step_id: "input",
            path: "run_id",
            message: "run_id is required",
            expected: ["non-empty run_id"],
            actual: [],
          },
        ],
        "run_id is required",
      ),
    );
  }

  const artifacts = Array.isArray(params.artifacts)
    ? params.artifacts
        .filter((item) => item && typeof item === "object" && !Array.isArray(item))
        .map((item) => item as Record<string, unknown>)
        .map((item) => ({
          type: String(item.type ?? ""),
          filename:
            typeof item.filename === "string" ? item.filename : undefined,
          content: String(item.content ?? ""),
          artifact_meta:
            item.artifact_meta &&
            typeof item.artifact_meta === "object" &&
            !Array.isArray(item.artifact_meta)
              ? (item.artifact_meta as Record<string, unknown>)
              : undefined,
          overwrite: item.overwrite === true,
        }))
    : undefined;

  try {
    const state = await applyFlowDecision(runId, {
      step_id: params.step_id ? String(params.step_id) : undefined,
      summary: params.summary ? String(params.summary) : undefined,
      decision_output: params.decision_output,
      artifacts,
      continue_after_apply: params.continue_after_apply !== false,
      stop_before_ai: params.stop_before_ai !== false,
    });
    return textResult(JSON.stringify(state));
  } catch (error: any) {
    if (error instanceof FlowDecisionContractError) {
      return jsonErrorResult(
        buildFlowDecisionErrorPayload(error.violations, error.message),
      );
    }
    return errorResult(error.message);
  }
}
