import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readAllEntries } from "../ctx-reader.js";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";

type TraceEntry = Record<string, unknown>;

interface TraceSpan {
  span_id: string;
  parent_span_id?: string;
  skill?: string;
  domain?: string;
  status: "in_progress" | "done" | "failed";
  events: TraceEntry[];
  children?: TraceSpan[];
}

function getStringField(entry: TraceEntry, key: string): string | undefined {
  const value = entry[key];
  return typeof value === "string" ? value : undefined;
}

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
  const spans: Record<string, TraceSpan> = {};
  const artifacts: string[] = [];
  
  for (const e of traceEvents) {
    const spanId = getStringField(e, "span_id") ?? "unknown";
    if (!spans[spanId]) {
      spans[spanId] = {
        span_id: spanId,
        parent_span_id: getStringField(e, "parent_span_id"),
        skill: getStringField(e, "skill"),
        domain: getStringField(e, "domain"),
        status: "in_progress",
        events: [],
      };
    }
    
    spans[spanId].events.push(e);
    
    const status = getStringField(e, "status");
    if (status === "done" || status === "failed") {
      spans[spanId].status = status;
    }
    
    if (status === "artifact_written") {
      const artifact = getStringField(e, "artifact");
      if (artifact) {
        artifacts.push(artifact);
      }
    }
  }

  // Reconstruct tree
  const rootSpans: TraceSpan[] = [];
  for (const span of Object.values(spans)) {
    const parentSpan = span.parent_span_id ? spans[span.parent_span_id] : undefined;
    if (parentSpan) {
      if (!parentSpan.children) {
        parentSpan.children = [];
      }
      parentSpan.children.push(span);
    } else {
      rootSpans.push(span);
    }
  }

  // Coordination Analysis
  let coordinationSheet: string | null = null;
  const projectRoot = getProjectRoot();
  const fs = await import("node:fs");
  const path = await import("node:path");

  for (const art of artifacts) {
    if (art.includes("coordination-sheet")) {
      const fullPath = path.resolve(projectRoot, ".ritsu", art);
      if (fs.existsSync(fullPath)) {
        coordinationSheet = fs.readFileSync(fullPath, "utf-8");
        break;
      }
    }
  }

  const coordinationIssues: string[] = [];
  if (coordinationSheet) {
    const spanMatches = coordinationSheet.matchAll(/\| (span-[0-9a-f]{8,}) \|/g);
    for (const match of spanMatches) {
      const declaredSpanId = match[1];
      if (!spans[declaredSpanId] || spans[declaredSpanId].status !== "done") {
        coordinationIssues.push(`Declared span ${declaredSpanId} is missing or not done.`);
      }
    }
  }

  return textResult(JSON.stringify({
    trace_id: traceId,
    tree: rootSpans,
    artifacts: Array.from(new Set(artifacts)),
    coordination: coordinationSheet ? {
      status: coordinationIssues.length === 0 ? "fully_coordinated" : "partial",
      issues: coordinationIssues
    } : undefined
  }, null, 2));
}
