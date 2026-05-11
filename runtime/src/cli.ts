#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

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

function usage(): string {
  return [
    "ritsu cat <cid>            # 按 correlation_id 展示一条任务链路的 ctx 事件（彩色）",
    "ritsu cat --recent <N>     # 展示最近 N 条 ctx 事件",
    "ritsu cat --file <path>    # 直接指定 ctx jsonl 文件路径",
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

function formatEvent(e: CtxEvent): string {
  const left = `${color(e.ts, "gray")} ${color(e.correlation_id, "blue")}`;
  const mid = `${color(e.skill, "yellow")} ${color(e.domain, "gray")}`;
  const st = color(e.status, statusColor(e.status));

  const extras: string[] = [];
  if (e.step) extras.push(`${color("step", "dim")}:${e.step}`);
  if (e.artifact && e.artifact !== "null") extras.push(`${color("artifact", "dim")}:${e.artifact}`);
  if (e.error) extras.push(`${color("error", "dim")}:${e.error}`);

  const extra = extras.length ? ` ${extras.join(" ")}` : "";
  return `${left}  ${mid}  ${st}${extra}`;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.log(usage());
    process.exit(0);
  }

  const cmd = args[0];
  if (cmd !== "cat") {
    console.error(color(`Unknown command: ${cmd}`, "red"));
    console.log(usage());
    process.exit(1);
  }

  const root = getProjectRoot();

  let filePath = "";
  let cid = "";
  let recentN: number | null = null;

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--file") {
      filePath = String(args[i + 1] ?? "");
      i++;
      continue;
    }
    if (a === "--recent") {
      recentN = Number(args[i + 1] ?? "0");
      i++;
      continue;
    }
    if (!a.startsWith("-")) {
      cid = a;
      continue;
    }
  }

  if (!filePath) {
    const latest = findLatestCtxFile(root);
    if (!latest) {
      console.error(color("No ctx-*.jsonl found under .ritsu/", "red"));
      process.exit(1);
    }
    filePath = latest;
  } else {
    filePath = resolve(root, filePath);
  }

  const events = parseJsonl(filePath);

  let out = events;
  if (typeof recentN === "number" && Number.isFinite(recentN) && recentN > 0) {
    out = events.slice(-recentN);
  } else if (cid) {
    out = events.filter((e) => e.correlation_id === cid);
  }

  if (out.length === 0) {
    console.error(color("No matching events", "yellow"));
    process.exit(2);
  }

  console.log(color(`ctx: ${filePath}`, "dim"));
  for (const e of out) {
    console.log(formatEvent(e));
  }
}

main();
