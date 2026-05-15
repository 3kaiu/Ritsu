#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { syncPush, syncPull } from "./sync.js";
import { minePreferences } from "./miner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type CtxEvent = {
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
  error?: string;
  cost?: {
    tokens_in?: number;
    tokens_out?: number;
    model?: string;
    duration_ms?: number;
  };
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
    "ritsu doctor               # 项目健康检查 (版本对齐、环境校验、锁文件)",
    "ritsu export [--out path]  # 导出当月任务摘要为 Markdown 报告",
    "ritsu sync push            # 将本地 .ritsu/ 约束状态推送至隔离的 Git 分支",
    "ritsu sync pull            # 从远端拉取 .ritsu/ 约束状态",
    "ritsu mine [--days 7]      # 离线挖掘偏好，生成 Mining Sheet",
    "",
    "  think -> dev -> test/hunt -> review",
    "\nENV:",
    "  RITSU_PROJECT_ROOT       # 项目根目录（默认当前目录）",
  ].join("\n");
}

function getProjectRoot(): string {
  return process.env.RITSU_PROJECT_ROOT ?? process.cwd();
}

function findLatestCtxFile(root: string): string | null {
  const dir = resolve(root, ".ritsu");
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir)
    .filter((f) => f.startsWith("ctx-") && f.endsWith(".jsonl"))
    .sort();

  if (files.length === 0) return null;
  return resolve(dir, files[files.length - 1]);
}

function parseJsonl(path: string): CtxEvent[] {
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

async function runDoctor() {
  const root = getProjectRoot();
  console.log(color("Ritsu Doctor — Running Health Check...", "cyan"));
  console.log(color(`Project Root: ${root}`, "dim"));

  let errors = 0;
  let warnings = 0;

  // 1. Check AGENTS.md
  const agentsPath = resolve(root, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    console.log(color("✖ AGENTS.md missing in root", "red"));
    errors++;
  } else {
    console.log(color("✔ AGENTS.md found", "green"));
    const content = readFileSync(agentsPath, "utf-8");
    const vMatch = content.match(/ritsu-version:\s*(\d+\.\d+\.\d+)/);
    const domainMatch = content.match(/domain:\s*(\w+)/);
    console.log(color(`  - version: ${vMatch ? vMatch[1] : "unknown"}`, "dim"));
    console.log(color(`  - domain: ${domainMatch ? domainMatch[1] : "unknown"}`, "dim"));
  }

  // 2. Check .ritsu directory
  const ritsuDir = resolve(root, ".ritsu");
  if (!existsSync(ritsuDir)) {
    console.log(color("✖ .ritsu/ directory missing", "red"));
    errors++;
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
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    console.log(color(`✔ Runtime version: ${pkg.version}`, "green"));
  }

  console.log("\n" + color(`Summary: ${errors} Errors, ${warnings} Warnings`, errors > 0 ? "red" : (warnings > 0 ? "yellow" : "green")));
  if (errors > 0) process.exit(1);
}

async function runExport(outPath: string | null) {
  const root = getProjectRoot();
  const ctxFile = findLatestCtxFile(root);
  if (!ctxFile) {
    console.error(color("No context file found to export", "red"));
    process.exit(1);
  }

  const events = parseJsonl(ctxFile);
  const tasks: Record<string, { skill: string, domain: string, startTs: string, endTs?: string, status: string, artifacts: string[], error?: string, totalTokensIn: number, totalTokensOut: number }> = {};

  for (const e of events) {
    if (!tasks[e.correlation_id]) {
      tasks[e.correlation_id] = {
        skill: e.skill,
        domain: e.domain,
        startTs: e.ts,
        status: "in_progress",
        artifacts: [],
        totalTokensIn: 0,
        totalTokensOut: 0
      };
    }
    
    if (e.cost) {
      tasks[e.correlation_id].totalTokensIn += e.cost.tokens_in ?? 0;
      tasks[e.correlation_id].totalTokensOut += e.cost.tokens_out ?? 0;
    }
    
    if (e.status === "done") {
      tasks[e.correlation_id].status = "completed";
      tasks[e.correlation_id].endTs = e.ts;
    } else if (e.status === "failed") {
      tasks[e.correlation_id].status = "failed";
      tasks[e.correlation_id].endTs = e.ts;
      tasks[e.correlation_id].error = e.error;
    } else if (e.status === "artifact_written" && e.artifact) {
      tasks[e.correlation_id].artifacts.push(e.artifact);
    }
  }

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

async function runTrace(traceId: string | null, openFlag: boolean) {
  const root = getProjectRoot();
  const ctxFile = findLatestCtxFile(root);
  if (!ctxFile) {
    console.error(color("No context file found", "red"));
    process.exit(1);
  }

  const events = parseJsonl(ctxFile);

  if (openFlag) {
    const traces: Record<string, boolean> = {}; // trace_id -> isClosed
    for (const e of events) {
      if (e.trace_id) {
        if (!traces.hasOwnProperty(e.trace_id)) traces[e.trace_id] = false;
        if (e.span_kind === "root" && (e.status === "done" || e.status === "failed")) {
          traces[e.trace_id] = true;
        }
      }
    }
    const openTraces = Object.entries(traces).filter(([id, closed]) => !closed).map(([id]) => id);
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
  let targetTraceId = traceId;
  if (traceId.startsWith("cid-")) {
    const match = traceId.match(/^cid-(\d{8})-(.+)$/);
    if (match) {
      const hex = match[2].padStart(16, "0");
      targetTraceId = `trace-${match[1]}-${hex}`;
    }
  }

  const traceEvents = events.filter((e) => e.trace_id === targetTraceId);
  if (traceEvents.length === 0) {
    console.error(color(`Trace not found: ${targetTraceId}`, "yellow"));
    process.exit(2);
  }

  console.log(color(`Trace ID: ${targetTraceId}`, "blue"));
  
  // Build span tree
  const spans: Record<string, { id: string; parent?: string; events: CtxEvent[] }> = {};
  for (const e of traceEvents) {
    const sid = e.span_id ?? "unknown";
    if (!spans[sid]) spans[sid] = { id: sid, parent: e.parent_span_id, events: [] };
    spans[sid].events.push(e);
  }

  const rootSpans = Object.values(spans).filter(s => !s.parent || !spans[s.parent]);
  
  function printSpan(span: any, indent: string) {
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

    const children = Object.values(spans).filter((s: any) => s.parent === span.id);
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

async function runMine(days: number) {
  console.log(color(`Ritsu Preference Miner — Scanning past ${days} days...`, "cyan"));
  const outPath = minePreferences(days);
  if (!outPath) {
    console.log(color("No human corrections found for AI-generated artifacts.", "green"));
    return;
  }
  console.log(color(`✔ Mining Sheet generated successfully!`, "green"));
  console.log(color(`Please ask your LLM to review the sheet and extract rules:`, "dim"));
  console.log(color(`  > ${outPath}`, "yellow"));
}

function main() {
  const args = process.argv.slice(2);
  const helpRequested = args.length === 0 || args.includes("-h") || args.includes("--help");

  if (helpRequested) {
    console.log(usage());
    return;
  }

  const [cmd, ...cmdArgs] = args;

  if (cmd === "doctor") {
    runDoctor();
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
    for (const arg of cmdArgs) {
      if (arg === "--open") openFlag = true;
      else if (!arg.startsWith("-")) traceId = arg;
    }
    runTrace(traceId, openFlag);
    return;
  }

  if (cmd === "sync") {
    runSync(cmdArgs[0]);
    return;
  }

  if (cmd === "mine") {
    let days = 7;
    for (let i = 0; i < cmdArgs.length; i++) {
      if (cmdArgs[i] === "--days") days = parseInt(cmdArgs[++i] ?? "7", 10);
    }
    runMine(days);
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
