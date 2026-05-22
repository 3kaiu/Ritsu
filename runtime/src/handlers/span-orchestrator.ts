import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { appendEvent } from "../ctx-writer.js";
import { readAllEntries } from "../ctx-reader.js";
import { validateEvent } from "../event-validator.js";
import { getProjectRoot, ts, textResult, errorResult } from "./_utils.js";
import { releaseAllForSpan } from "./file-lease.js";
import { dispatchHook } from "../hooks/index.js";
import { randomBytes } from "node:crypto";

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

function generateTraceId(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const hex = randomBytes(8).toString("hex");
  return `trace-${dateStr}-${hex}`;
}

function generateSpanId(): string {
  return `span-${randomBytes(4).toString("hex")}`;
}

function getStringField(entry: TraceEntry, key: string): string | undefined {
  const value = entry[key];
  return typeof value === "string" ? value : undefined;
}

// ─── Open Span ───

export async function ritsu_open_span(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();

  const skill = String(params.skill ?? "unknown");
  const domain = String(params.domain ?? "unknown");

  let traceId = params.trace_id ? String(params.trace_id) : undefined;
  let parentSpanId = params.parent_span_id ? String(params.parent_span_id) : undefined;

  if (process.env.RITSU_TRACE_PARENT && !traceId) {
    const [t, p] = process.env.RITSU_TRACE_PARENT.split(":");
    traceId = t;
    if (!parentSpanId) parentSpanId = p;
  }

  if (!traceId) traceId = generateTraceId();
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

  return textResult(JSON.stringify({
    trace_id: traceId,
    span_id: spanId,
    status: "started",
  }));
}

// ─── Close Span ───

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

  await releaseAllForSpan(root, spanId);

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

// ─── Span Lifecycle Router ───

export async function ritsu_span_lifecycle(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const action = String(params.action ?? "open");
  if (action === "open") {
    return ritsu_open_span(params);
  } else if (action === "close") {
    return ritsu_close_span(params);
  }
  return errorResult(`Invalid span lifecycle action: ${action}`);
}

// ─── Join Trace (rebuild span tree from events) ───

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
      issues: coordinationIssues,
    } : undefined,
  }, null, 2));
}
