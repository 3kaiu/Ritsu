import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readAllEntries } from "../ctx-reader.js";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";

export async function ritsu_join_trace(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const traceId = String(params.trace_id ?? "");
  
  if (!traceId) {
    return errorResult("trace_id is required");
  }

  const entries = readAllEntries(root);
  const traceEvents = entries.filter((e) => e.trace_id === traceId);
  
  if (traceEvents.length === 0) {
    return errorResult(`trace not found: ${traceId}`);
  }

  // Build span tree
  const spans: Record<string, any> = {};
  const artifacts: string[] = [];
  
  for (const e of traceEvents) {
    const spanId = String(e.span_id ?? "unknown");
    if (!spans[spanId]) {
      spans[spanId] = {
        span_id: spanId,
        parent_span_id: e.parent_span_id,
        skill: e.skill,
        domain: e.domain,
        status: "in_progress",
        events: []
      };
    }
    
    spans[spanId].events.push(e);
    
    if (e.status === "done" || e.status === "failed") {
      spans[spanId].status = e.status;
    }
    
    if (e.status === "artifact_written" && e.artifact) {
      artifacts.push(String(e.artifact));
    }
  }

  // Reconstruct tree
  const rootSpans = [];
  for (const span of Object.values(spans)) {
    if (span.parent_span_id && spans[span.parent_span_id]) {
      if (!spans[span.parent_span_id].children) {
        spans[span.parent_span_id].children = [];
      }
      spans[span.parent_span_id].children.push(span);
    } else {
      rootSpans.push(span);
    }
  }

  return textResult(JSON.stringify({
    trace_id: traceId,
    tree: rootSpans,
    artifacts: Array.from(new Set(artifacts))
  }, null, 2));
}
