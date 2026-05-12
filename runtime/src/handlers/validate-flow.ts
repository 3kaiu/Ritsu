import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getFlowById, validateFlowManifest } from "../flow-runtime.js";
import { errorResult, textResult } from "./_utils.js";

export async function ritsu_validate_flow(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const flowId = String(params.flow_id ?? "");
  if (!flowId) return errorResult("flow_id is required");

  const manifest = getFlowById(flowId);
  if (!manifest) return errorResult(`flow not found: ${flowId}`);

  const validation = validateFlowManifest(manifest);
  return textResult(
    JSON.stringify({
      flow_id: flowId,
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
    }),
  );
}
