import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { appendEvent } from "../ctx-writer.js";
import { validateEvent } from "../event-validator.js";
import { getProjectRoot, ts, textResult, errorResult } from "./_utils.js";

export async function ritsu_close_span(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  
  const traceId = String(params.trace_id ?? "");
  const spanId = String(params.span_id ?? "");
  const status = String(params.status ?? "done");
  const skill = String(params.skill ?? "unknown");
  const domain = String(params.domain ?? "unknown");
  
  if (!traceId || !spanId) {
    return errorResult("trace_id and span_id are required");
  }

  if (status !== "done" && status !== "failed") {
    return errorResult("status must be done or failed");
  }
  
  const event: Record<string, unknown> = {
    ts: ts(),
    trace_id: traceId,
    span_id: spanId,
    skill,
    domain,
    status,
  };

  if (params.error && status === "failed") {
    event.error = String(params.error);
  }
  
  if (params.cost) {
    event.cost = params.cost;
  }

  const validation = validateEvent(event);
  if (!validation.valid) {
    return errorResult(`event validation failed: ${validation.errors?.join(", ")}`);
  }

  await appendEvent(root, event);

  return textResult(JSON.stringify({
    trace_id: traceId,
    span_id: spanId,
    status,
  }));
}
