import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  buildFlowDecisionErrorPayload,
  resumeFlowRun,
} from "../flow-runtime.js";
import { errorResult, jsonErrorResult, textResult } from "./_utils.js";

export async function ritsu_resume_flow(
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

  try {
    const state = await resumeFlowRun(runId, {
      stop_before_ai: params.stop_before_ai !== false,
      dry_run: params.dry_run === true,
    });
    return textResult(JSON.stringify(state));
  } catch (error: any) {
    return errorResult(error.message);
  }
}
