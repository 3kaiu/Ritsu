import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { validateEvent } from "../event-validator.js";
import { textResult, errorResult } from "./_utils.js";

export async function ritsu_validate(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const dataJson = String(params.data ?? "");
  const schemaType = String(params.schema_type ?? "ctx_event");

  if (!dataJson) return errorResult("data is required (JSON string)");

  if (schemaType === "ctx_event") {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataJson);
    } catch (e: any) {
      return errorResult(`invalid JSON: ${e.message}`);
    }

    const validation = validateEvent(data);
    return textResult(JSON.stringify(validation));
  }

  return errorResult(`unknown schema_type: ${schemaType}`);
}
