#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { syncPush, syncPull } from "./sync.js";
import { minePreferences, promotePreference } from "./miner.js";
import { legacyCidToTraceId } from "./correlation.js";
import { detectProjectRoot } from "./project-root.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type CtxEvent = {
  ts: string;
  correlation_id: string;
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
  span_kind?: "root" | "internal";
  skill: string;
  domain: string;
  status: "started" | "done" | "failed" | "artifact_written" | "violation_detected";
  step?: string;
  artifact?: string;
  artifact_meta?: {
    type?: string;
    canonical_type?: string;
    layer?: string;
    size_bytes?: number;
    summary?: string;
  };
  error?: string;
  cost?: {
    tokens_in?: number;
    tokens_out?: number;
    model?: string;
    duration_ms?: number;
  };
  violation?: {
    rule_id: string;
    severity: string;
    evidence?: string;
    blocked?: boolean;
  };
};

type ArtifactWrittenCtxEvent = CtxEvent & {
  status: "artifact_written";
  artifact_meta?: NonNullable<CtxEvent["artifact_meta"]>;
};

export type TraceSpanNode = {
  id: string;
  parent?: string;
  events: CtxEvent[];
  children?: TraceSpanNode[];
};

export type RuntimeMetadata = {
  packageVersion: string | null;
  protocolVersion: string | null;
};

export type TaskSummary = {
  skill: string;
  domain: string;
  startTs: string;
  endTs?: string;
  status: "in_progress" | "completed" | "failed";
  artifacts: string[];
  error?: string;
  totalTokensIn: number;
  totalTokensOut: number;
};

const COLORS = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
};

function color(text: string, c: keyof typeof COLORS): string {
  return `${COLORS[c]}${text}${COLORS.reset}`;
}

export function usage(): string {
  return [
    "ritsu cat <cid>            # 按 correlation_id 展示一条任务链路的 ctx 事件（彩色）",
    "ritsu cat --recent <N>     # 展示最近 N 条 ctx 事件",
    "ritsu cat --file <path>    # 直接指定 ctx jsonl 文件路径",
    "ritsu trace <id>           # 展示 Trace 链路和 Span 树（自动兼容 legacy CID）",
    "ritsu trace --open         # 展示当前所有未关闭的 Trace",
    "ritsu trace --check-triple  # 验证最新 Trace 的三方一致性 (Design ↔ Dev ↔ Assurance)",
    "ritsu doctor               # 项目健康检查 (版本对齐、环境校验、锁文件)",
    "ritsu doctor --hot-rules   # 离线统计 30 天内 rule_id 触发热度",
    "ritsu doctor --health      # 输出核心健康度 4 指标与趋势分析",
    "ritsu export [--out path]  # 导出当月任务摘要为 Markdown 报告",
    "ritsu sync push            # 将本地 .ritsu/ 约束状态推送至隔离的 Git 分支",
    "ritsu sync pull            # 从远端拉取 .ritsu/ 约束状态",
    "ritsu mine --report [--days 7]  # 离线挖掘偏好，生成 Mining Sheet",
    "ritsu mine --promote <id>  # 将 Mining Sheet 中的提议晋升为正式偏好",
    "",
    "  think -> dev -> test/hunt -> review",
    "\nENV:",
    "  RITSU_PROJECT_ROOT       # 项目根目录（默认当前目录）",
  ].join("\n");
}

function getProjectRoot(): string {
  return detectProjectRoot();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
        // polyfill trace_id
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
    } catch {
      // ignore bad lines
    }
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
      if (isRecord(parsed)) {
        rows.push(parsed);
      }
    } catch {
      // ignore bad lines
    }
  }
  return rows;
}

export function readCoveragePct(root: string): string {
  const qgFile = resolve(root, ".ritsu/last-quality-gate.json");
  if (!existsSync(qgFile)) return "0.0";

  try {
    const qg = JSON.parse(readFileSync(qgFile, "utf-8"));
    const value =
      qg.coverage?.summary?.lines?.pct ??
      qg.coverage?.total?.lines?.pct ??
      "0.0";
    return String(value);
  } catch {
    return "0.0";
  }
}

export function readRuntimeMetadataFromPackageJson(
  pkgPath: string,
): RuntimeMetadata {
  if (!existsSync(pkgPath)) {
    return { packageVersion: null, protocolVersion: null };
  }

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as unknown;
    if (!isRecord(pkg)) {
      return { packageVersion: null, protocolVersion: null };
    }
    return {
      packageVersion: typeof pkg.version === "string" ? pkg.version : null,
      protocolVersion:
        typeof pkg.ritsu_protocol_version === "string"
          ? pkg.ritsu_protocol_version
          : null,
    };
  } catch {
    return { packageVersion: null, protocolVersion: null };
  }
}

function readRuntimeMetadata(): RuntimeMetadata {
  return readRuntimeMetadataFromPackageJson(resolve(__dirname, "../package.json"));
}

function statusColor(status: CtxEvent["status"]): keyof typeof COLORS {
  switch (status) {
    case "started":
      return "cyan";
    case "done":
      return "green";
    case "failed":
      return "red";
    case "artifact_written":
      return "magenta";
    default:
      return "gray";
  }
}

function isArtifactWrittenEvent(event: CtxEvent): event is ArtifactWrittenCtxEvent {
  return event.status === "artifact_written";
}

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
    if (events[i].trace_id) {
      return events[i].trace_id ?? null;
    }
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
      (event.correlation_id &&
        legacyCidToTraceId(event.correlation_id) === traceId),
  );
}

export function getOpenTraceIds(events: CtxEvent[]): string[] {
  const traces: Record<string, boolean> = {};

  for (const event of events) {
    if (!event.trace_id) continue;

    if (!Object.hasOwn(traces, event.trace_id)) {
      traces[event.trace_id] = false;
    }
    if (
      event.span_kind === "root" &&
      (event.status === "done" || event.status === "failed")
    ) {
      traces[event.trace_id] = true;
    }
  }

  return Object.entries(traces)
    .filter(([_id, closed]) => !closed)
    .map(([id]) => id);
}

export function countTripleVerifiedTraces(events: CtxEvent[]): {
  traceIds: string[];
  triplePassed: number;
} {
  const traceIds = [
    ...new Set(
      events
        .map((event) => event.trace_id)
        .filter(
          (traceId): traceId is string =>
            typeof traceId === "string" && traceId.length > 0,
        ),
    ),
  ];

  let triplePassed = 0;
  for (const traceId of traceIds) {
    const types = getArtifactTypes(getTraceEvents(events, traceId));
    if (
      (types.has("design-sheet") || types.has("design-brief")) &&
      types.has("dev-report") &&
      types.has("assurance-sheet")
    ) {
      triplePassed++;
    }
  }

  return { traceIds, triplePassed };
}

export function buildTraceSpanForest(traceEvents: CtxEvent[]): TraceSpanNode[] {
  const spans: Record<string, TraceSpanNode> = {};

  for (const event of traceEvents) {
    const spanId = event.span_id ?? "unknown";
    if (!spans[spanId]) {
      spans[spanId] = {
        id: spanId,
        parent: event.parent_span_id,
        events: [],
      };
    }
    spans[spanId].events.push(event);
  }

  const rootSpans: TraceSpanNode[] = [];
  for (const span of Object.values(spans)) {
    if (span.parent && spans[span.parent]) {
      const parent = spans[span.parent];
      if (!parent.children) {
        parent.children = [];
      }
      parent.children.push(span);
    } else {
      rootSpans.push(span);
    }
  }

  return rootSpans;
}

export function summarizeTasks(events: CtxEvent[]): Record<string, TaskSummary> {
  const tasks: Record<string, TaskSummary> = {};

  for (const event of events) {
    if (!tasks[event.correlation_id]) {
      tasks[event.correlation_id] = {
        skill: event.skill,
        domain: event.domain,
        startTs: event.ts,
        status: "in_progress",
        artifacts: [],
        totalTokensIn: 0,
        totalTokensOut: 0,
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

export function formatSkill(skill: string): string {
  return skill;
}

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
  ]
    .filter(Boolean)
    .join(" ");

  return `${ts} ${cid}  ${skill} ${domain}  ${status}${details ? ` ${details}` : ""}`;
}

export async function runHotRules(since: string | null = null) {
  const root = getProjectRoot();
  const ritsuDir = resolve(root, ".ritsu");
  if (!existsSync(ritsuDir)) return;

  const files = readdirSync(ritsuDir).filter(f => f.startsWith("ctx-") && f.endsWith(".jsonl")).sort();
  
  const counts: Record<string, number> = {};
  const limitDate = since ? since.replace(/-/g, "") : new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");

  for (const f of files) {
    const events = parseJsonl(resolve(ritsuDir, f));
    for (const e of events) {
      if (e.status === "violation_detected" && e.violation?.rule_id) {
        if (e.ts.slice(0, 8) >= limitDate) {
          counts[e.violation.rule_id] = (counts[e.violation.rule_id] || 0) + 1;
        }
      }
    }
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    console.log(color("No violations detected in the specified period.", "gray"));
  } else {
    console.log(color(`Top Hot Rules (Since ${limitDate}):`, "cyan"));
    for (const [rid, count] of sorted.slice(0, 10)) {
      console.log(`  - ${color(rid, "yellow")}: ${count} times`);
    }
  }
}

export async function runDoctorHealth() {
  const root = getProjectRoot();
  console.log(color("Ritsu Health Dashboard — Objective Metrics", "cyan"));

  const ctxFile = findLatestCtxFile(root);
  if (!ctxFile) {
    console.error(color("No context file found", "red"));
    return;
  }

  const events = parseJsonl(ctxFile);
  const totalEvents = events.length;
  const violations = events.filter(e => e.status === "violation_detected").length;

  // Metric 1: Interception Rate
  const interceptRate = totalEvents > 0 ? (violations / totalEvents * 100).toFixed(1) : "0.0";
  console.log(`- Policy Interception Rate:   ${color(`${interceptRate}%`, "yellow")} (${violations} violations in ${totalEvents} events)`);

  // Metric 2: Preference Promotion
  const promoted = events.filter(e => e.skill === "miner" && e.status === "done").length;
  console.log(`- Preference Promotion Rate: ${color(`${promoted}`, "yellow")} rules promoted this month`);

  // Metric 3: Coverage Trend
  const currentCoverage = readCoveragePct(root);
  console.log(`- Current Test Coverage:      ${color(`${currentCoverage}%`, "green")}`);

  // Metric 4: Triple Verification Rate
  const { traceIds: traces, triplePassed } = countTripleVerifiedTraces(events);
  const tripleRate = traces.length > 0 ? (triplePassed / traces.length * 100).toFixed(1) : "0.0";
  console.log(`- Triple Verification Rate:   ${color(`${tripleRate}%`, "cyan")} (${triplePassed}/${traces.length} traces)`);

  // Snapshotting
  const snapshotFile = resolve(root, ".ritsu/health-snapshots.jsonl");
  const previousSnapshots = existsSync(snapshotFile)
    ? parseLooseJsonl(snapshotFile)
    : [];
  const snapshot = {
    ts: new Date().toISOString(),
    interceptRate,
    promoted,
    currentCoverage,
    tripleRate,
    tracesCount: traces.length
  };
  appendFileSync(snapshotFile, JSON.stringify(snapshot) + "\n");
  console.log(color(`\n✔ Health snapshot saved to .ritsu/health-snapshots.jsonl`, "dim"));

  if (previousSnapshots.length > 0) {
    const prev = previousSnapshots[previousSnapshots.length - 1];
    const prevCoverage = prev?.currentCoverage;
    if (typeof prevCoverage === "string" || typeof prevCoverage === "number") {
      const diff = (
        parseFloat(currentCoverage) - parseFloat(String(prevCoverage))
      ).toFixed(1);
      const trend = parseFloat(diff) >= 0 ? color(`+${diff}%`, "green") : color(`${diff}%`, "red");
      console.log(`Trend: Coverage moved ${trend} since last check.`);
    }
  }
}

export async function runDoctor(args: string[] = []) {
  const root = getProjectRoot();
  console.log(color("Ritsu Doctor — Running Health Check...", "cyan"));
  console.log(color(`Project Root: ${root}`, "dim"));

  if (args.includes("--hot-rules")) {
    let since = null;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--since") since = args[++i];
    }
    await runHotRules(since);
    return;
  }

  if (args.includes("--health")) {
    await runDoctorHealth();
    return;
  }

  let errors = 0;
  let warnings = 0;
// ...

  // 1. Check AGENTS.md
  const agentsPath = resolve(root, "AGENTS.md");
  let agentsVersion: string | null = null;
  if (!existsSync(agentsPath)) {
    console.log(color("✖ AGENTS.md missing in root", "red"));
    errors++;
  } else {
    console.log(color("✔ AGENTS.md found", "green"));
    const content = readFileSync(agentsPath, "utf-8");
    const vMatch = content.match(/ritsu-version:\s*(\d+\.\d+\.\d+)/);
    const domainMatch = content.match(/domain:\s*(\w+)/);
    agentsVersion = vMatch ? vMatch[1] : null;
    console.log(color(`  - version: ${vMatch ? vMatch[1] : "unknown"}`, "dim"));
    console.log(color(`  - domain: ${domainMatch ? domainMatch[1] : "unknown"}`, "dim"));
  }

  // 2. Check .ritsu directory
  const ritsuDir = resolve(root, ".ritsu");
  if (!existsSync(ritsuDir)) {
    console.log(color("⚠ .ritsu/ directory missing (will be created on first run)", "yellow"));
    warnings++;
  } else {
    console.log(color("✔ .ritsu/ directory found", "green"));
    
    // Check for lock files
    const locks = readdirSync(ritsuDir).filter(f => f.endsWith(".lock"));
    if (locks.length > 0) {
      console.log(color(`⚠ Stale lock files found: ${locks.join(", ")}`, "yellow"));
      warnings++;
    }
  }

  // 3. Check for ctx file
  const ctxFile = findLatestCtxFile(root);
  if (!ctxFile) {
    console.log(color("⚠ No context (jsonl) file found for this month", "yellow"));
    warnings++;
  } else {
    console.log(color(`✔ Found latest ctx file: ${ctxFile}`, "green"));
    try {
      const events = parseJsonl(ctxFile);
      console.log(color(`  - Events recorded: ${events.length}`, "dim"));
    } catch {
      console.log(color("✖ Failed to parse ctx file", "red"));
      errors++;
    }
  }

  // 4. Version consistency check (runtime vs schema)
  const pkgPath = resolve(__dirname, "../package.json");
  if (existsSync(pkgPath)) {
    const runtimeMeta = readRuntimeMetadata();
    if (runtimeMeta.packageVersion) {
      console.log(color(`✔ Runtime version: ${runtimeMeta.packageVersion}`, "green"));
    }
    if (runtimeMeta.protocolVersion) {
      console.log(color(`  - protocol version: ${runtimeMeta.protocolVersion}`, "dim"));
    }

    if (
      runtimeMeta.packageVersion &&
      runtimeMeta.protocolVersion &&
      runtimeMeta.packageVersion !== runtimeMeta.protocolVersion
    ) {
      console.log(
        color(
          `✖ runtime/package.json version mismatch: ${runtimeMeta.packageVersion} != ${runtimeMeta.protocolVersion}`,
          "red",
        ),
      );
      errors++;
    }

    if (
      agentsVersion &&
      runtimeMeta.protocolVersion &&
      agentsVersion !== runtimeMeta.protocolVersion
    ) {
      console.log(
        color(
          `✖ AGENTS.md ritsu-version mismatch: ${agentsVersion} != ${runtimeMeta.protocolVersion}`,
          "red",
        ),
      );
      errors++;
    }
  }

  console.log("\n" + color(`Summary: ${errors} Errors, ${warnings} Warnings`, errors > 0 ? "red" : (warnings > 0 ? "yellow" : "green")));
  if (errors > 0) process.exit(1);
}

export async function runExport(outPath: string | null) {
  const root = getProjectRoot();
  const ctxFile = findLatestCtxFile(root);
  if (!ctxFile) {
    console.error(color("No context file found to export", "red"));
    process.exit(1);
  }

  const events = parseJsonl(ctxFile);
  const tasks = summarizeTasks(events);

  const lines = [
    `# Ritsu Task Export — ${new Date().toISOString().slice(0, 10)}`,
    `Generated from: \`${ctxFile}\``,
    "",
    "## Task History",
    "",
    "| CID | Skill | Domain | Status | Duration | Artifacts | Tokens (In/Out) |",
    "| --- | --- | --- | --- | --- | --- | --- |"
  ];

  for (const [cid, t] of Object.entries(tasks)) {
    const statusIcon = t.status === "completed" ? "✅" : (t.status === "failed" ? "❌" : "⏳");
    const arts = t.artifacts.length > 0 ? t.artifacts.map(a => `\`${a}\``).join(", ") : "-";
    const tokens = `${t.totalTokensIn} / ${t.totalTokensOut}`;
    lines.push(`| \`${cid}\` | ${t.skill} | ${t.domain} | ${statusIcon} ${t.status} | ${t.startTs} | ${arts} | ${tokens} |`);
  }

  const markdown = lines.join("\n");
  if (outPath) {
    writeFileSync(resolve(root, outPath), markdown);
    console.log(color(`Exported to: ${outPath}`, "green"));
  } else {
    console.log(markdown);
  }
}

export async function runTrace(traceId: string | null, openFlag: boolean = false, checkTriple: boolean = false) {
  const root = getProjectRoot();
  const ctxFile = findLatestCtxFile(root);
  if (!ctxFile) {
    console.error(color("No context file found", "red"));
    process.exit(1);
  }

  if (checkTriple) {
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

  // Handle legacy CID input
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
    for (const child of children) {
      printSpan(child, indent + "│  ");
    }
  }

  console.log(color("Span Tree:", "dim"));
  for (const root of rootSpans) {
    printSpan(root, "");
  }
}

async function runSync(action: string) {
  if (action === "push") {
    console.log(color("Pushing .ritsu harness to refs/ritsu/* ...", "dim"));
    const ok = syncPush();
    if (ok) console.log(color("✔ Sync push successful.", "green"));
    else console.error(color("✖ Sync push failed.", "red"));
  } else if (action === "pull") {
    console.log(color("Pulling .ritsu harness from refs/ritsu/* ...", "dim"));
    const ok = syncPull();
    if (ok) console.log(color("✔ Sync pull successful.", "green"));
    else console.error(color("✖ Sync pull failed.", "red"));
  } else {
    console.error(color(`Unknown sync action: ${action}`, "red"));
    process.exit(1);
  }
}

async function runMine(args: string[]) {
  let days = 7;
  let report = false;
  let promoteId: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days") days = parseInt(args[++i] ?? "7", 10);
    else if (args[i] === "--report") report = true;
    else if (args[i] === "--promote") promoteId = args[++i] ?? null;
  }

  if (promoteId) {
    console.log(color(`Ritsu Preference Miner — Promoting ${promoteId}...`, "cyan"));
    const ok = promotePreference(promoteId);
    if (ok) {
      console.log(color(`✔ Preference ${promoteId} promoted successfully to .ritsu/preferences.yaml`, "green"));
    } else {
      console.error(color(`✖ Failed to find proposal for ${promoteId} in recent mining sheets.`, "red"));
      process.exit(1);
    }
    return;
  }

  if (report || args.length === 0) {
    console.log(color(`Ritsu Preference Miner — Scanning past ${days} days...`, "cyan"));
    const outPath = minePreferences(days);
    if (!outPath) {
      console.log(color("No human corrections or violations found.", "green"));
      return;
    }
    console.log(color(`✔ Mining Sheet generated successfully!`, "green"));
    console.log(color(`Please ask your LLM to review the sheet and extract rules:`, "dim"));
    console.log(color(`  > ${outPath}`, "yellow"));
    return;
  }

  console.log(usage());
}

export function main() {
  const args = process.argv.slice(2);
  const helpRequested = args.length === 0 || args.includes("-h") || args.includes("--help");

  if (helpRequested) {
    console.log(usage());
    return;
  }

  const [cmd, ...cmdArgs] = args;

  if (cmd === "doctor") {
    runDoctor(cmdArgs);
    return;
  }

  if (cmd === "export") {
    let outPath = null;
    for (let i = 0; i < cmdArgs.length; i++) {
      if (cmdArgs[i] === "--out") outPath = cmdArgs[++i];
    }
    runExport(outPath);
    return;
  }

  if (cmd === "trace") {
    let traceId = null;
    let openFlag = false;
    let checkTriple = false;
    for (const arg of cmdArgs) {
      if (arg === "--open") openFlag = true;
      else if (arg === "--check-triple") checkTriple = true;
      else if (!arg.startsWith("-")) traceId = arg;
    }
    runTrace(traceId, openFlag, checkTriple);
    return;
  }

  if (cmd === "sync") {
    runSync(cmdArgs[0]);
    return;
  }

  if (cmd === "mine") {
    runMine(cmdArgs);
    return;
  }

  if (cmd !== "cat") {
    console.error(color(`Unknown command: ${cmd}`, "red"));
    console.log(usage());
    process.exit(1);
  }

  // Parse cat command arguments
  const options = {
    filePath: "",
    cid: "",
    recentN: null as number | null,
  };

  for (let i = 0; i < cmdArgs.length; i++) {
    const arg = cmdArgs[i];
    if (arg === "--file") {
      options.filePath = cmdArgs[++i] ?? "";
    } else if (arg === "--recent") {
      options.recentN = parseInt(cmdArgs[++i] ?? "0", 10);
    } else if (!arg.startsWith("-")) {
      options.cid = arg;
    }
  }

  const root = getProjectRoot();
  const finalPath = options.filePath ? resolve(root, options.filePath) : findLatestCtxFile(root);

  if (!finalPath || !existsSync(finalPath)) {
    console.error(color(`Context file not found: ${finalPath ?? ".ritsu/ctx-*.jsonl"}`, "red"));
    process.exit(1);
  }

  const events = parseJsonl(finalPath);
  let outputEvents = events;

  if (options.recentN !== null && options.recentN > 0) {
    outputEvents = events.slice(-options.recentN);
  } else if (options.cid) {
    outputEvents = events.filter((e) => e.correlation_id === options.cid);
  }

  if (outputEvents.length === 0) {
    console.error(color("No matching events found", "yellow"));
    process.exit(2);
  }

  console.log(color(`ctx: ${finalPath}`, "dim"));
  console.log(color("skill mapping: standard delivery flow: think -> dev -> test/hunt -> review", "dim"));
  outputEvents.forEach((e) => console.log(formatEvent(e)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
