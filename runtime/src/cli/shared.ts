import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { legacyCidToTraceId } from "../correlation.js";
import { isRecord } from "../shared.js";
import type { CtxEvent, ArtifactWrittenCtxEvent, RuntimeMetadata } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const COLORS = {
  reset: "[0m",
  dim: "[2m",
  red: "[31m",
  green: "[32m",
  yellow: "[33m",
  blue: "[34m",
  magenta: "[35m",
  cyan: "[36m",
  gray: "[90m",
};

export function color(text: string, c: keyof typeof COLORS): string {
  return `${COLORS[c]}${text}${COLORS.reset}`;
}

export function statusColor(status: CtxEvent["status"]): keyof typeof COLORS {
  switch (status) {
    case "started": return "cyan";
    case "done": return "green";
    case "failed": return "red";
    case "artifact_written": return "magenta";
    default: return "gray";
  }
}

function isArtifactWrittenEvent(event: CtxEvent): event is ArtifactWrittenCtxEvent {
  return event.status === "artifact_written";
}

// ─── Ctx file utilities ───────────────────────────────────────

export function findLatestCtxFile(root: string): string | null {
  const dir = resolve(root, ".ritsu");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("ctx-") && f.endsWith(".jsonl"))
    .sort();
  if (files.length === 0) return null;
  return resolve(dir, files[files.length - 1]);
}

export function parseJsonl(path: string): CtxEvent[] {
  const raw = readFileSync(path, "utf-8");
  const events: CtxEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as CtxEvent;
      if (obj && obj.status) {
        if (obj.correlation_id && !obj.trace_id) {
          const match = obj.correlation_id.match(/^cid-(\d{8})-(.+)$/);
          if (match) {
            const dateStr = match[1];
            const seqStr = match[2];
            const hex = seqStr.padStart(16, "0");
            const spanHex = seqStr.padStart(8, "0");
            obj.trace_id = `trace-${dateStr}-${hex}`;
            obj.span_id = `span-${spanHex}`;
          } else if (obj.correlation_id.startsWith("trace-")) {
            obj.trace_id = obj.correlation_id;
            obj.span_id = `span-00000000`;
          }
        }
        if (!obj.correlation_id && obj.trace_id) {
          obj.correlation_id = obj.trace_id;
        }
        events.push(obj);
      }
    } catch { /* ignore bad lines */ }
  }
  return events;
}

export function parseLooseJsonl(path: string): Array<Record<string, unknown>> {
  const raw = readFileSync(path, "utf-8");
  const rows: Array<Record<string, unknown>> = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed)) rows.push(parsed);
    } catch { /* ignore bad lines */ }
  }
  return rows;
}

export function readCoveragePct(root: string): string {
  const qgFile = resolve(root, ".ritsu/last-quality-gate.json");
  if (!existsSync(qgFile)) return "0.0";
  try {
    const qg = JSON.parse(readFileSync(qgFile, "utf-8"));
    const value = qg.coverage?.summary?.lines?.pct ?? qg.coverage?.total?.lines?.pct ?? "0.0";
    return String(value);
  } catch { return "0.0"; }
}

export function readRuntimeMetadataFromPackageJson(pkgPath: string): RuntimeMetadata {
  if (!existsSync(pkgPath)) return { packageVersion: null, protocolVersion: null };
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as unknown;
    if (!isRecord(pkg)) return { packageVersion: null, protocolVersion: null };
    return {
      packageVersion: typeof pkg.version === "string" ? pkg.version : null,
      protocolVersion: typeof pkg.ritsu_protocol_version === "string" ? pkg.ritsu_protocol_version : null,
    };
  } catch { return { packageVersion: null, protocolVersion: null }; }
}

export function readRuntimeMetadata(): RuntimeMetadata {
  return readRuntimeMetadataFromPackageJson(resolve(__dirname, "../../package.json"));
}

// ─── Trace utilities ──────────────────────────────────────────

export function getArtifactTypes(events: CtxEvent[]): Set<string> {
  return new Set(
    events
      .filter(isArtifactWrittenEvent)
      .map((event) => event.artifact_meta?.type)
      .filter((type): type is string => typeof type === "string" && type.length > 0),
  );
}

export function getLatestTraceId(events: CtxEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].trace_id) return events[i].trace_id ?? null;
  }
  return null;
}

export function normalizeTraceId(traceId: string): string {
  if (!traceId.startsWith("cid-")) return traceId;
  const match = traceId.match(/^cid-(\d{8})-(.+)$/);
  if (!match) return traceId;
  const hex = match[2].padStart(16, "0");
  return `trace-${match[1]}-${hex}`;
}

export function getTraceEvents(events: CtxEvent[], traceId: string): CtxEvent[] {
  return events.filter(
    (event) =>
      event.trace_id === traceId ||
      (event.correlation_id && legacyCidToTraceId(event.correlation_id) === traceId),
  );
}

export function getOpenTraceIds(events: CtxEvent[]): string[] {
  const traces: Record<string, boolean> = {};
  for (const event of events) {
    if (!event.trace_id) continue;
    if (!Object.hasOwn(traces, event.trace_id)) traces[event.trace_id] = false;
    if (event.span_kind === "root" && (event.status === "done" || event.status === "failed")) {
      traces[event.trace_id] = true;
    }
  }
  return Object.entries(traces).filter(([_id, closed]) => !closed).map(([id]) => id);
}

export function countTripleVerifiedTraces(events: CtxEvent[]): {
  traceIds: string[];
  triplePassed: number;
} {
  const traceIds = [...new Set(events.map((event) => event.trace_id).filter((t): t is string => typeof t === "string" && t.length > 0))];
  let triplePassed = 0;
  for (const traceId of traceIds) {
    const types = getArtifactTypes(getTraceEvents(events, traceId));
    if ((types.has("design-sheet") || types.has("design-brief")) && types.has("dev-report") && types.has("assurance-sheet")) {
      triplePassed++;
    }
  }
  return { traceIds, triplePassed };
}

export function buildTraceSpanForest(traceEvents: CtxEvent[]): import("./types.js").TraceSpanNode[] {
  const spans: Record<string, import("./types.js").TraceSpanNode> = {};
  for (const event of traceEvents) {
    const spanId = event.span_id ?? "unknown";
    if (!spans[spanId]) spans[spanId] = { id: spanId, parent: event.parent_span_id, events: [] };
    spans[spanId].events.push(event);
  }
  const rootSpans: import("./types.js").TraceSpanNode[] = [];
  for (const span of Object.values(spans)) {
    if (span.parent && spans[span.parent]) {
      const parent = spans[span.parent];
      if (!parent.children) parent.children = [];
      parent.children.push(span);
    } else {
      rootSpans.push(span);
    }
  }
  return rootSpans;
}

// ─── Task summary ─────────────────────────────────────────────

export function summarizeTasks(events: CtxEvent[]): Record<string, import("./types.js").TaskSummary> {
  const tasks: Record<string, import("./types.js").TaskSummary> = {};
  for (const event of events) {
    if (!tasks[event.correlation_id]) {
      tasks[event.correlation_id] = {
        skill: event.skill, domain: event.domain, startTs: event.ts,
        status: "in_progress", artifacts: [], totalTokensIn: 0, totalTokensOut: 0,
      };
    }
    if (event.cost) {
      tasks[event.correlation_id].totalTokensIn += event.cost.tokens_in ?? 0;
      tasks[event.correlation_id].totalTokensOut += event.cost.tokens_out ?? 0;
    }
    if (event.status === "done") {
      tasks[event.correlation_id].status = "completed";
      tasks[event.correlation_id].endTs = event.ts;
    } else if (event.status === "failed") {
      tasks[event.correlation_id].status = "failed";
      tasks[event.correlation_id].endTs = event.ts;
      tasks[event.correlation_id].error = event.error;
    } else if (event.status === "artifact_written" && event.artifact) {
      tasks[event.correlation_id].artifacts.push(event.artifact);
    }
  }
  return tasks;
}

// ─── Formatting ───────────────────────────────────────────────

export function formatSkill(skill: string): string { return skill; }

export function formatEvent(e: CtxEvent): string {
  const ts = color(e.ts, "gray");
  const idStr = e.trace_id ? e.trace_id.slice(-8) + ":" + (e.span_id?.slice(-8) ?? "") : e.correlation_id;
  const cid = color(idStr, "blue");
  const skill = color(e.skill, "yellow");
  const domain = color(e.domain, "gray");
  const status = color(e.status, statusColor(e.status));
  const details = [
    e.step && `${color("step", "dim")}:${e.step}`,
    e.artifact && e.artifact !== "null" && `${color("artifact", "dim")}:${e.artifact}`,
    e.error && `${color("error", "dim")}:${e.error}`,
  ].filter(Boolean).join(" ");
  return `${ts} ${cid}  ${skill} ${domain}  ${status}${details ? ` ${details}` : ""}`;
}
