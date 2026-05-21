import { detectProjectRoot } from "../project-root.js";
import {
  findLatestCtxFile, parseJsonl, color, statusColor,
  getLatestTraceId, getArtifactTypes, getTraceEvents,
  getOpenTraceIds, normalizeTraceId, buildTraceSpanForest,
} from "./shared.js";
import type { CtxEvent, TraceSpanNode } from "./types.js";

export async function runTrace(traceId: string | null, openFlag = false, checkTriple = false) {
  const root = detectProjectRoot();
  const ctxFile = findLatestCtxFile(root);
  if (!ctxFile) {
    console.error(color("No context file found", "red"));
    process.exit(1);
  }

  if (checkTriple) {
    runCheckTriple(ctxFile);
    return;
  }

  const events = parseJsonl(ctxFile);

  if (openFlag) {
    const openTraces = getOpenTraceIds(events);
    if (openTraces.length === 0) {
      console.log(color("No open traces found.", "green"));
      return;
    }
    console.log(color("Open Traces:", "cyan"));
    for (const id of openTraces) {
      const rootEvent = events.find(e => e.trace_id === id && e.status === "started");
      const skill = rootEvent ? rootEvent.skill : "unknown";
      console.log(`- ${color(id, "blue")} (${color(skill, "yellow")})`);
    }
    return;
  }

  if (!traceId) {
    console.error(color("Please provide a trace ID or use --open", "red"));
    process.exit(1);
  }

  const targetTraceId = normalizeTraceId(traceId);
  const traceEvents = getTraceEvents(events, targetTraceId);
  if (traceEvents.length === 0) {
    console.error(color(`Trace not found: ${targetTraceId}`, "yellow"));
    process.exit(2);
  }

  console.log(color(`Trace ID: ${targetTraceId}`, "blue"));
  const rootSpans = buildTraceSpanForest(traceEvents);

  function printSpan(span: TraceSpanNode, indent: string) {
    const sorted = span.events.sort((a: CtxEvent, b: CtxEvent) => a.ts.localeCompare(b.ts));
    const startE = sorted.find((e: CtxEvent) => e.status === "started") || sorted[0];
    const endE = sorted.slice().reverse().find((e: CtxEvent) => e.status === "done" || e.status === "failed");
    const skill = color(startE.skill, "yellow");
    const domain = color(startE.domain, "dim");
    const status = endE ? color(endE.status, statusColor(endE.status)) : color("started", "cyan");
    const durationStr = (startE && endE && endE.cost?.duration_ms) ? color(` ${endE.cost.duration_ms}ms`, "dim") : "";
    console.log(`${indent}├─ [${color(span.id.slice(-8), "blue")}] ${skill} ${domain} - ${status}${durationStr}`);
    const artifacts = sorted.filter((e: CtxEvent) => e.status === "artifact_written" && e.artifact).map((e: CtxEvent) => e.artifact);
    if (artifacts.length > 0) {
      console.log(`${indent}│  └─ ${color("artifacts:", "dim")} ${artifacts.join(", ")}`);
    }
    const children = span.children ?? [];
    for (const child of children) printSpan(child, indent + "│  ");
  }

  console.log(color("Span Tree:", "dim"));
  for (const root of rootSpans) printSpan(root, "");
}

function runCheckTriple(ctxFile: string) {
  console.log(color("Ritsu Triple Verification — Checking latest Trace...", "cyan"));
  const events = parseJsonl(ctxFile);
  const lastTraceId = getLatestTraceId(events);
  if (!lastTraceId) {
    console.error(color("✖ No traces found in the latest context file.", "red"));
    process.exit(1);
  }
  const types = getArtifactTypes(getTraceEvents(events, lastTraceId));
  const hasDesign = types.has("design-sheet") || types.has("design-brief");
  const hasDev = types.has("dev-report");
  const hasAssurance = types.has("assurance-sheet");
  console.log(`Trace: ${color(lastTraceId, "yellow")}`);
  console.log(`- Design:    ${hasDesign ? color("✔", "green") : color("✘", "red")}`);
  console.log(`- Dev:       ${hasDev ? color("✔", "green") : color("✘", "red")}`);
  console.log(`- Assurance: ${hasAssurance ? color("✔", "green") : color("✘", "red")}`);
  if (hasDesign && hasDev && hasAssurance) {
    console.log(color("\n✔ Triple Verification Passed!", "green"));
  } else {
    console.error(color("\n✖ Triple Verification Failed! Missing evidence in chain.", "red"));
    process.exit(1);
  }
}
