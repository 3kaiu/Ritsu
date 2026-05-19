import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { appendEvent } from "../ctx-writer.js";
import { validateEvent } from "../event-validator.js";
import { getProjectRoot, ts, textResult, errorResult } from "./_utils.js";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { releaseAllForSpan } from "./file-lease.js";
import { dispatchHook } from "../hooks/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  if (params.step) {
    event.step = String(params.step);
  }

  if (params.metadata) {
    event.metadata = params.metadata;
  }

  const validation = validateEvent(event);
  if (!validation.valid) {
    return errorResult(`event validation failed: ${validation.errors?.join(", ")}`);
  }

  await appendEvent(root, event);

  // Batch 8.3: Release all file leases for this span
  await releaseAllForSpan(root, spanId);

  // Dispatch lifecycle hooks (non-blocking in background or awaited)
  // We don't await so the MCP response returns immediately
  dispatchHook({
    type: "span_closed",
    payload: {
      trace_id: traceId,
      span_id: spanId,
      skill,
      domain,
      status: status as "done" | "failed",
    },
  }).catch((err) => {
    console.error("[Hook Dispatcher Error]", err);
  });

  return textResult(JSON.stringify({
    trace_id: traceId,
    span_id: spanId,
    status,
  }));
}
