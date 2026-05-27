/**
 * ritsu violations — CLI command for the Violation Tracker
 *
 * Subcommands:
 *   ritsu violations              → List all open violations
 *   ritsu violations --open       → Same (default)
 *   ritsu violations --per-file   → Grouped by file
 *   ritsu violations --trend      → Monthly open/closed trend
 *   ritsu violations --rule R-3   → Filter by rule ID
 *   ritsu violations --json       → Raw JSON output
 *   ritsu violations resolve <id> → Mark as fixed
 *
 * v8.4.0
 */

import { detectProjectRoot } from "../project-root.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { color } from "./shared.js";
import {
  readStore,
  getOpenViolations,
  getViolationsByFile,
  getViolationTrend,
  resolveViolation,
  queryViolations,
} from "../violation-tracker.js";

function severityColor(sev: string, text: string): string {
  if (sev === "fatal" || sev === "hard_stop") return color(text, "red");
  if (sev === "error") return color(text, "yellow");
  return text;
}

export function runViolations(cmdArgs: string[]): void {
  const root = detectProjectRoot();
  if (!root || !existsSync(resolve(root, ".ritsu"))) {
    console.error(color("❌ Not a Ritsu-enabled project.", "red"));
    process.exit(1);
  }

  const showJson = cmdArgs.includes("--json");
  const showTrend = cmdArgs.includes("--trend");
  const showPerFile = cmdArgs.includes("--per-file");
  const showOpen = cmdArgs.includes("--open") || !cmdArgs.some((a) => a.startsWith("--") || a === "resolve");
  const resolveId = cmdArgs[0] === "resolve" ? cmdArgs[1] : null;
  const ruleFilter = cmdArgs.includes("--rule") ? cmdArgs[cmdArgs.indexOf("--rule") + 1] : null;

  // Handle resolve
  if (resolveId) {
    const ok = resolveViolation(root, resolveId, "fixed");
    if (ok) {
      console.log(color(`✅ Violation ${resolveId} resolved as fixed.`, "green"));
    } else {
      console.error(color(`❌ Violation ${resolveId} not found.`, "red"));
      process.exit(1);
    }
    return;
  }

  // Trend
  if (showTrend) {
    const trend = getViolationTrend(root);
    if (trend.length === 0) {
      console.log("No violation history.");
      return;
    }

    if (showJson) {
      console.log(JSON.stringify(trend, null, 2));
      return;
    }

    console.log("\nViolation Trend");
    console.log("================");
    console.log(`| ${"Month".padEnd(9)} | ${"Opened".padEnd(8)} | ${"Resolved".padEnd(8)} | ${"Net".padEnd(6)} |`);
    console.log(`|${"-".repeat(11)}|${"-".repeat(10)}|${"-".repeat(10)}|${"-".repeat(8)}|`);
    for (const t of trend) {
      const netStr = t.net > 0 ? color(`+${t.net}`, "red") : t.net < 0 ? color(String(t.net), "green") : "0";
      console.log(`| ${t.period.padEnd(9)} | ${String(t.opened).padEnd(8)} | ${String(t.resolved).padEnd(8)} | ${String(netStr).padEnd(6)} |`);
    }
    console.log("");
    return;
  }

  // Per-file
  if (showPerFile) {
    const byFile = getViolationsByFile(root);
    const keys = Object.keys(byFile);

    if (keys.length === 0) {
      console.log(color("✅ No open violations.", "green"));
      return;
    }

    if (showJson) {
      console.log(JSON.stringify(byFile, null, 2));
      return;
    }

    console.log(`\nOpen Violations by File (${keys.length} files, ${Object.values(byFile).flat().length} total)`);
    console.log("=".repeat(60));
    for (const [file, violations] of Object.entries(byFile)) {
      console.log(`\n  ${color(file, "cyan")} (${violations.length})`);
      for (const v of violations) {
        console.log(`    ${severityColor(v.severity, `[${v.rule_id}]`)} ${v.message.slice(0, 80)}`);
        console.log(`      created: ${v.created_at.slice(0, 19)} | id: ${v.id}`);
      }
    }
    console.log("");
    return;
  }

  // Default: list open
  const openViolations = ruleFilter
    ? queryViolations(root, { status: ["open", "acknowledged"], rule_id: ruleFilter })
    : getOpenViolations(root);

  if (openViolations.length === 0) {
    console.log(color("✅ No open violations.", "green"));
    return;
  }

  if (showJson) {
    console.log(JSON.stringify(openViolations, null, 2));
    return;
  }

  console.log(`\nOpen Violations (${openViolations.length})`);
  console.log("=".repeat(60));
  for (const v of openViolations) {
    const id = color(v.id, "cyan");
    const rule = severityColor(v.severity, `[${v.rule_id}]`);
    console.log(`  ${rule} ${v.message}`);
    console.log(`    File: ${v.file} | ${id}`);
    if (v.trace_id) console.log(`    Trace: ${v.trace_id}`);
    console.log(`    Created: ${v.created_at.slice(0, 19)}`);
    console.log("");
  }
}
