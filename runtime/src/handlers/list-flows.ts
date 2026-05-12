import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { summarizeFlowCatalog } from "../flow-runtime.js";
import { textResult } from "./_utils.js";

export async function ritsu_list_flows(): Promise<CallToolResult> {
  const flows = summarizeFlowCatalog();
  return textResult(
    JSON.stringify({
      flows,
      total_count: flows.length,
    }),
  );
}
