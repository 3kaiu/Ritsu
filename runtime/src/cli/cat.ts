import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { detectProjectRoot } from "../project-root.js";
import { findLatestCtxFile, parseJsonl, color, formatEvent } from "./shared.js";

export function runCat(args: string[]) {
  const root = detectProjectRoot();
  const options = { filePath: "", cid: "", recentN: null as number | null };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--file") options.filePath = args[++i] ?? "";
    else if (arg === "--recent") options.recentN = parseInt(args[++i] ?? "0", 10);
    else if (!arg.startsWith("-")) options.cid = arg;
  }

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
