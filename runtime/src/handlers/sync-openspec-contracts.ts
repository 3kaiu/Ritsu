import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";
import { syncOpenSpecContracts } from "../openspec-bridge.js";

export async function ritsu_sync_openspec_contracts(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const changeId =
    typeof params.change_id === "string" ? params.change_id : undefined;

  const result = syncOpenSpecContracts(root, changeId);
  if ("error" in result) {
    return errorResult(result.error);
  }

  return textResult(JSON.stringify(result, null, 2));
}
