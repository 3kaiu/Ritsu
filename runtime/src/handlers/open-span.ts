import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { appendEvent } from "../ctx-writer.js";
import { validateEvent } from "../event-validator.js";
import { getProjectRoot, ts, textResult, errorResult } from "./_utils.js";
import { randomBytes } from "node:crypto";

function generateTraceId(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const hex = randomBytes(8).toString("hex");
  return `trace-${dateStr}-${hex}`;
}

function generateSpanId(): string {
  return `span-${randomBytes(4).toString("hex")}`;
}

export async function ritsu_open_span(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  
  const skill = String(params.skill ?? "unknown");
  const domain = String(params.domain ?? "unknown");
  const parentSpanId = params.parent_span_id ? String(params.parent_span_id) : undefined;
  const traceId = params.trace_id ? String(params.trace_id) : generateTraceId();
  const spanId = generateSpanId();
  
  const event: Record<string, unknown> = {
    ts: ts(),
    trace_id: traceId,
    span_id: spanId,
    skill,
    domain,
    status: "started",
    span_kind: parentSpanId ? "internal" : "root",
  };

  if (parentSpanId) {
    event.parent_span_id = parentSpanId;
  }
  
  if (params.agent) {
    event.agent = params.agent;
  }

  if (params.name) {
    event.name = String(params.name);
  }

  if (params.metadata) {
    event.metadata = params.metadata;
  }

  const validation = validateEvent(event);
  if (!validation.valid) {
    return errorResult(`event validation failed: ${validation.errors?.join(", ")}`);
  }

  await appendEvent(root, event);

  return textResult(JSON.stringify({
    trace_id: traceId,
    span_id: spanId,
    status: "started",
  }));
}
