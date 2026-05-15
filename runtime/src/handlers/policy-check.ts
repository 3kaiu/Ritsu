import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { textResult, errorResult } from "./_utils.js";
import { evaluatePolicies } from "../policy/index.js";
import type { PolicyCheckContext } from "../policy/types.js";

export async function ritsu_policy_check(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const action = String(params.action ?? "");
  
  if (action !== "write_artifact" && action !== "emit_event" && action !== "commit_diff") {
    return errorResult("action must be write_artifact, emit_event, or commit_diff");
  }

  const ctx: PolicyCheckContext = {
    action: action as any,
    target: params.target ? String(params.target) : undefined,
    content: params.content ? String(params.content) : undefined,
    context: params.context as any,
  };

  const result = evaluatePolicies(ctx);

  return textResult(JSON.stringify(result, null, 2));
}
