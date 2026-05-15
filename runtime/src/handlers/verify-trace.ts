import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readAllEntries } from "../ctx-reader.js";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";
import { verifyEvent, getOrCreateKey } from "../policy/signature.js";

export async function ritsu_verify_trace(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const traceId = String(params.trace_id ?? "");
  const key = getOrCreateKey();
  
  if (!key) {
    return errorResult("No trust key found. Use ritsu_init_trust_key first.");
  }

  const entries = readAllEntries(root);
  const traceEvents = entries.filter((e) => e.trace_id === traceId);
  
  if (traceEvents.length === 0) {
    return errorResult(`trace not found: ${traceId}`);
  }

  let violationCount = 0;
  const details = traceEvents.map(e => {
    const valid = verifyEvent(e, key);
    if (!valid) violationCount++;
    return {
      span_id: e.span_id,
      status: e.status,
      valid
    };
  });

  return textResult(JSON.stringify({
    trace_id: traceId,
    valid: violationCount === 0,
    violation_count: violationCount,
    details
  }));
}
