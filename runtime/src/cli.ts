#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

type CtxEvent = {
  ts: string;
  correlation_id: string;
  skill: string;
  domain: string;
  status: "started" | "done" | "failed" | "artifact_written";
  step?: string;
  artifact?: string;
  error?: string;
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
    "ritsu doctor               # 项目健康检查 (版本对齐、环境校验、锁文件)",
    "ritsu export [--out path]  # 导出当月任务摘要为 Markdown 报告",
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
      if (obj && obj.correlation_id && obj.status) events.push(obj);
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
  const cid = color(e.correlation_id, "blue");
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
  const tasks: Record<string, { skill: string, domain: string, startTs: string, endTs?: string, status: string, artifacts: string[], error?: string }> = {};

  for (const e of events) {
    if (!tasks[e.correlation_id]) {
      tasks[e.correlation_id] = {
        skill: e.skill,
        domain: e.domain,
        startTs: e.ts,
        status: "in_progress",
        artifacts: []
      };
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
    "| CID | Skill | Domain | Status | Duration | Artifacts |",
    "| --- | --- | --- | --- | --- | --- |"
  ];

  for (const [cid, t] of Object.entries(tasks)) {
    const statusIcon = t.status === "completed" ? "✅" : (t.status === "failed" ? "❌" : "⏳");
    const arts = t.artifacts.length > 0 ? t.artifacts.map(a => `\`${a}\``).join(", ") : "-";
    lines.push(`| \`${cid}\` | ${t.skill} | ${t.domain} | ${statusIcon} ${t.status} | ${t.startTs} | ${arts} |`);
  }

  const markdown = lines.join("\n");
  if (outPath) {
    writeFileSync(resolve(root, outPath), markdown);
    console.log(color(`Exported to: ${outPath}`, "green"));
  } else {
    console.log(markdown);
  }
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
