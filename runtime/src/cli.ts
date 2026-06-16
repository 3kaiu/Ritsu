#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { color } from "./cli/shared.js";
import { runCat } from "./cli/cat.js";
import { runTrace } from "./cli/trace.js";
import { runDoctor } from "./cli/doctor.js";
import { runExport } from "./cli/export.js";
import { runSync } from "./cli/sync.js";
import { runMine } from "./cli/mine.js";
import { runBootstrap } from "./cli/bootstrap.js";
import { runCheck } from "./cli/check.js";
import { runReport } from "./cli/report.js";
import { runViolations } from "./cli/violations.js";
import { spawnSync } from "node:child_process";
import { detectProjectRoot } from "./project-root.js";
import { getRitsudBinaryPath } from "./launcher.js";


export { runDoctor, runDoctorHealth } from "./cli/doctor.js";
export { runExport } from "./cli/export.js";
export { runTrace } from "./cli/trace.js";
export { runMine } from "./cli/mine.js";
export { runBootstrap } from "./cli/bootstrap.js";

export function runStatus() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { existsSync } = require("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { resolve } = require("node:path");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { detectProjectRoot } = require("./project-root.js");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readLastIncomplete, readLastCompleted } = require("./ctx-reader.js");

  const root = detectProjectRoot();
  const ritsuDir = resolve(root, ".ritsu");
  const hasRitsu = existsSync(ritsuDir);

  console.log("Ritsu Status");
  console.log("============");
  console.log(`Project: ${root}`);
  console.log(`Initialized: ${hasRitsu ? "✅" : "❌ (run /r-init first)"}`);
  console.log("");

  if (hasRitsu) {
    const lastComplete = readLastCompleted(root);
    const lastIncomplete = readLastIncomplete(root);
    const hasPrefs = existsSync(resolve(root, ".ritsu/preferences.yaml"));
    const hasKey = existsSync(resolve(root, ".ritsu/secret.key"));

    console.log(`Last completed: ${lastComplete?.skill ?? "none"} (${lastComplete?.status ?? "n/a"})`);
    console.log(`Last incomplete: ${lastIncomplete?.skill ?? "none"} (${String(lastIncomplete?.status ?? "n/a")})`);
    console.log(`Preferences: ${hasPrefs ? "✅" : "—"}`);
    console.log(`Trust key: ${hasKey ? "✅" : "—"}`);
    console.log("");

    if (lastIncomplete) {
      console.log(`Breakpoint: ${lastIncomplete.step ?? "?"} — ${String(lastIncomplete.recovery_context?.resume_hint ?? "")}`);
      console.log(`Suggestion: ${String(lastIncomplete.recovery_context?.recommended_next_step ?? "none")}`);
    }
  }
}


export function usage(detailed = false): string {
  const lines = [
    "Usage: ritsu <command> [options]",
    "",
    "User Commands:",
    "  ritsu bootstrap    # Init project (.mcp.json + ecosystem.json)",
    "  ritsu bootstrap --demo  # Generate demo data for quick try",
    "  ritsu init         # Initialize git pre-commit policy hook (delegates to ritsud)",
    "  ritsu doctor       # Health check",
    "  ritsu doctor --ecosystem # MCP ecosystem verification",
    "  ritsu doctor --signals   # Structured audit (PASS/WARN/FAIL)",
    "  ritsu doctor --ai        # AI tool configuration check",
    "  ritsu trust        # Init/overwrite HMAC key",
    "  ritsu verify <id>  # Verify trace HMAC signature",
    "  ritsu mine --auto   # Auto preference learning",
    "  ritsu report        # Agent behavior & cost report",
    "  ritsu status        # Project status overview",
    "  ritsu daemon start|stop|status # Manage background heartbeat scheduler",
    "  ritsu loop list|trigger|status|resume # Inspect, execute or resume autopilot loops",
    "  ritsu sync-rules   # Synchronize autopilot rules to IDE rules",
    "",
    "Ritsu CLI — think → dev → review → deploy → hunt",
    "",
  ];

  if (detailed) {
    lines.push(
      "Development / Debug:",
      "  ritsu cat <cid>      # View ctx events",
      "  ritsu trace <id>     # Trace links & span tree",
      "  ritsu export         # Export monthly task report",
      "  ritsu sync push/pull  # .ritsu Git sync",
      "  ritsu mine --auto     # Auto preference learning",
      "  ritsu report          # Agent behavior analytics",
      "  ritsu violations      # List unresolved violations",
      "  ritsu violations --per-file # Group by file",
      "  ritsu violations --trend    # Monthly trend",
      "  ritsu violations resolve <id> # Mark violation as fixed",
      "  ritsu report --cost  # Cost breakdown by model",
      "  ritsu report --trend # Quality trend over time",
      "  ritsu report --json  # JSON output format",
      "  ritsu report --month 3 # Specify months range",
      "",
    );
  }

  lines.push(
    "ENV:",
    "  RITSU_PROJECT_ROOT       # Project root (default: current dir)",
    "",
    "Use 'ritsu help' for all commands.",
  );

  return lines.join("\n");
}

export function main() {
  const args = process.argv.slice(2);
  const [cmd, ...cmdArgs] = args;

  if (!cmd || cmd === "-h" || cmd === "--help") { console.log(usage()); return; }
  if (cmd === "help") { console.log(usage(true)); return; }

  if (cmd === "bootstrap") { runBootstrap(cmdArgs); return; }
  if (cmd === "init") {
    const root = detectProjectRoot();
    const ritsudPath = getRitsudBinaryPath(root);
    if (ritsudPath) {
      console.log(color("⚡ Delegating to native ritsud init...", "cyan"));
      const ritsudResult = spawnSync(ritsudPath, ["init"], { cwd: root, stdio: "inherit" });
      process.exit(ritsudResult.status ?? 0);
    } else {
      console.error(color("❌ Native ritsud binary not found. Please compile it first with 'bun run build:rust' or ensure a valid cached/optional-dep sidecar is present.", "red"));
      process.exit(1);
    }
  }
  if (cmd === "doctor") { runDoctor(cmdArgs); return; }
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
  if (cmd === "sync") { runSync(cmdArgs[0]); return; }
  if (cmd === "mine" || cmd === "learn") { runMine(cmdArgs); return; }
  if (cmd === "status") { runStatus(); return; }
  if (cmd === "cat") { runCat(cmdArgs); return; }
  if (cmd === "check") { runCheck(cmdArgs); return; }
  if (cmd === "report") { runReport(cmdArgs); return; }
  if (cmd === "violations") { runViolations(cmdArgs); return; }
  if (cmd === "daemon") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { runDaemon } = require("./cli/daemon.js");
    runDaemon(cmdArgs);
    return;
  }
  if (cmd === "loop") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { runLoop } = require("./cli/loop.js");
    runLoop(cmdArgs);
    return;
  }
  if (cmd === "sync-rules") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { syncLoopInstructionsToIDE } = require("./ide-rules-sync.js");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { detectProjectRoot } = require("./project-root.js");
    const root = detectProjectRoot();
    const success = syncLoopInstructionsToIDE(root);
    if (success) {
      console.log(color("✅ Autopilot loop rules successfully synced to IDE rules.", "green"));
    } else {
      console.error(color("❌ Failed to sync autopilot loop rules.", "red"));
      process.exit(1);
    }
    return;
  }


  if (cmd === "trust") {
    const force = cmdArgs.includes("--force");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { initKey, getOrCreateKey } = require("./policy/signature.js");
    const existing = getOrCreateKey();
    if (existing && !force) {
      console.log(color("❌ Trust key already exists. Use 'ritsu trust --force' to overwrite (CAUTION: invalidates old signatures).", "yellow"));
      return;
    }
    initKey();
    console.log(color("✅ Trust key initialized. All future events will be HMAC-signed.", "green"));
    return;
  }

  if (cmd === "verify") {
    const traceId = cmdArgs[0];
    if (!traceId) {
      console.error(color("❌ Missing trace ID. Usage: ritsu verify <trace_id>", "red"));
      process.exit(1);
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getOrCreateKey, verifyEvent } = require("./policy/signature.js");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readAllEntries } = require("./ctx-reader.js");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getProjectRoot } = require("./handlers/_utils.js");

    const key = getOrCreateKey();
    if (!key) {
      console.error(color("❌ No trust key found. Use 'ritsu trust' first.", "red"));
      process.exit(1);
    }

    const root = getProjectRoot();
    const entries = readAllEntries(root);
    const traceEvents = entries.filter((e: any) => e.trace_id === traceId);
    
    if (traceEvents.length === 0) {
      console.error(color(`❌ Trace not found: ${traceId}`, "red"));
      process.exit(1);
    }

    let violationCount = 0;
    const details = traceEvents.map((e: any) => {
      const valid = verifyEvent(e, key);
      if (!valid) violationCount++;
      return {
        span_id: e.span_id,
        status: e.status,
        valid
      };
    });

    console.log(JSON.stringify({
      trace_id: traceId,
      valid: violationCount === 0,
      violation_count: violationCount,
      details
    }, null, 2));
    return;
  }

  console.error(color(`Unknown command: ${cmd}`, "red"));
  console.log(usage());
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
