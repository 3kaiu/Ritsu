#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getStageForSkill } from "./shared.js";

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

/**
 * Formats a context event into a colorized string for terminal display.
 */
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

/**
 * Main entry point for Ritsu CLI.
 * Handles command routing and argument parsing.
 */
function main() {
  const args = process.argv.slice(2);
  const helpRequested = args.length === 0 || args.includes("-h") || args.includes("--help");

  if (helpRequested) {
    console.log(usage());
    return;
  }

  const [cmd, ...cmdArgs] = args;
  if (cmd !== "cat") {
    console.error(color(`Unknown command: ${cmd}`, "red"));
    console.log(usage());
    process.exit(1);
  }

  // Parse command arguments
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
  let finalPath = options.filePath ? resolve(root, options.filePath) : findLatestCtxFile(root);

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
