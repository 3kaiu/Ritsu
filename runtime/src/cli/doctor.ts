import { resolve, dirname } from "node:path";
import { existsSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { detectProjectRoot } from "../project-root.js";
import { findSimilarViolations, loadViolationRecords } from "../similar-violations.js";
import { checkEcosystem } from "../ecosystem-bootstrap.js";
import {
  findLatestCtxFile, parseJsonl, parseLooseJsonl, color,
  readCoveragePct, readRuntimeMetadata, countTripleVerifiedTraces,
} from "./shared.js";

export async function runDoctor(args: string[] = []) {
  const root = detectProjectRoot();
  console.log(color("Ritsu Doctor — Running Health Check...", "cyan"));
  console.log(color(`Project Root: ${root}`, "dim"));

  if (args.includes("--ecosystem")) { runDoctorEcosystem(); return; }
  if (args.includes("--health")) { await runDoctorHealth(); return; }
  if (args.includes("--signals")) { runSignals(root); return; }

  if (args.includes("--similar-violations")) {
    let sinceDays = 30;
    let query = "";
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--since") sinceDays = parseInt((args[++i] ?? "30d").replace(/d$/i, ""), 10) || 30;
      else if (args[i] === "--query") query = args[++i] ?? "";
    }
    await runSimilarViolations(sinceDays, query);
    return;
  }

  let errors = 0;
  let warnings = 0;

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
    const locks = readdirSync(ritsuDir).filter((f: string) => f.endsWith(".lock"));
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

  // 4. Version consistency check
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(__dirname, "../../package.json");
  if (existsSync(pkgPath)) {
    const runtimeMeta = readRuntimeMetadata();
    if (runtimeMeta.packageVersion) console.log(color(`✔ Runtime version: ${runtimeMeta.packageVersion}`, "green"));
    if (runtimeMeta.protocolVersion) console.log(color(`  - protocol version: ${runtimeMeta.protocolVersion}`, "dim"));
    if (agentsVersion && runtimeMeta.protocolVersion && agentsVersion !== runtimeMeta.protocolVersion) {
      console.log(color(`✖ AGENTS.md ritsu-version mismatch: ${agentsVersion} != ${runtimeMeta.protocolVersion}`, "red"));
      errors++;
    }
  }

  console.log("\n" + color(`Summary: ${errors} Errors, ${warnings} Warnings`, errors > 0 ? "red" : (warnings > 0 ? "yellow" : "green")));
  if (errors > 0) process.exit(1);
}

/**
 * Waza-style audit signals.
 * Outputs structured labeled blocks ending with PASS/WARN/FAIL status.
 * Designed for LLM consumption — skimmable, machine-readable.
 */
function runSignals(root: string): void {
  const signals: string[] = [];

  // Signal 1: Project structure
  const hasAgents = existsSync(resolve(root, "AGENTS.md"));
  const hasRitsuDir = existsSync(resolve(root, ".ritsu"));
  const hasClaudeMd = existsSync(resolve(root, "CLAUDE.md"));
  const hasMcpJson = existsSync(resolve(root, ".mcp.json"));
  signals.push(`[signal:project-structure]
agents_md: ${hasAgents}
ritsu_dir: ${hasRitsuDir}
claude_md: ${hasClaudeMd}
mcp_json: ${hasMcpJson}
status: ${hasAgents && hasRitsuDir ? "PASS" : "FAIL"}`);

  // Signal 2: Package manager
  const hasBunLock = existsSync(resolve(root, "bun.lock"));
  const hasPackageJson = existsSync(resolve(root, "package.json"));
  signals.push(`[signal:package-manager]
bun_lock: ${hasBunLock}
package_json: ${hasPackageJson}
status: ${hasPackageJson ? "PASS" : "FAIL"}`);

  // Signal 3: Build health
  const distMcpIndex = resolve(root, "runtime/dist/index.js");
  const distCli = resolve(root, "runtime/dist/cli.js");
  const hasBuild = existsSync(distMcpIndex) && existsSync(distCli);
  signals.push(`[signal:build-health]
mcp_server: ${existsSync(distMcpIndex)}
cli: ${existsSync(distCli)}
status: ${hasBuild ? "PASS" : "FAIL"}`);

  // Signal 4: Ctx file health
  const ctxFile = findLatestCtxFile(root);
  signals.push(`[signal:ctx-health]
ctx_present: ${ctxFile !== null}
status: ${ctxFile ? "PASS" : "WARN"}`);

  // Signal 5: Version consistency
  const runtimeMeta = readRuntimeMetadata();
  const agentsContent = hasAgents ? readFileSync(resolve(root, "AGENTS.md"), "utf-8") : "";
  const agentsVersion = agentsContent.match(/ritsu-version:\s*(\d+\.\d+\.\d+)/);
  const versionsMatch = agentsVersion && runtimeMeta.protocolVersion === agentsVersion[1];
  signals.push(`[signal:version-consistency]
agents_version: ${agentsVersion?.[1] ?? "missing"}
runtime_protocol: ${runtimeMeta.protocolVersion ?? "missing"}
status: ${versionsMatch ? "PASS" : "FAIL"}`);

  // Signal 6: Ritsu native module
  const hasNative = existsSync(resolve(root, "runtime/native/ritsu-native.darwin-arm64.node"));
  signals.push(`[signal:native-module]
native_available: ${hasNative}
status: PASS`); // Graceful fallback — not a failure

  // Signal 7: underlying MCP tools
  signals.push(`[signal:mcp-tools]
mcp_json: ${existsSync(resolve(root, ".mcp.json")) ? "present" : "missing"}
status: PASS`);

  console.log(signals.join("\n\n"));
}

async function runSimilarViolations(sinceDays = 30, query = "") {
  const root = detectProjectRoot();
  const ritsuDir = resolve(root, ".ritsu");
  const since = new Date(Date.now() - sinceDays * 24 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  const records = loadViolationRecords(ritsuDir, since);
  if (records.length === 0) {
    console.log(color("No violation_detected events in period.", "gray"));
    return;
  }
  const q = query.trim() || "scope policy violation";
  const hits = findSimilarViolations(records, q, 10);
  console.log(color(`Similar violations (Jaccard, since ${sinceDays}d, query="${q}"):`, "cyan"));
  if (hits.length === 0) {
    console.log(color("  No matches above threshold.", "gray"));
    console.log(color("  Tip: sqlite-vec indexing is optional future work; see docs/integrations.md", "dim"));
    return;
  }
  for (const h of hits) {
    console.log(`  - ${color(h.rule_id, "yellow")} score=${h.score.toFixed(2)} ts=${h.ts}`);
    if (h.evidence) console.log(color(`    ${h.evidence.slice(0, 120)}`, "dim"));
  }
}

export async function runDoctorHealth() {
  const root = detectProjectRoot();
  console.log(color("Ritsu Health Dashboard — Objective Metrics", "cyan"));
  const ctxFile = findLatestCtxFile(root);
  if (!ctxFile) { console.error(color("No context file found", "red")); return; }
  const events = parseJsonl(ctxFile);
  const totalEvents = events.length;
  const violations = events.filter(e => e.status === "violation_detected").length;
  const interceptRate = totalEvents > 0 ? (violations / totalEvents * 100).toFixed(1) : "0.0";
  console.log(`- Policy Interception Rate:   ${color(`${interceptRate}%`, "yellow")} (${violations} violations in ${totalEvents} events)`);
  const promoted = events.filter(e => e.skill === "miner" && e.status === "done").length;
  console.log(`- Preference Promotion Rate: ${color(`${promoted}`, "yellow")} rules promoted this month`);
  const currentCoverage = readCoveragePct(root);
  console.log(`- Current Test Coverage:      ${color(`${currentCoverage}%`, "green")}`);
  const { traceIds: traces, triplePassed } = countTripleVerifiedTraces(events);
  const tripleRate = traces.length > 0 ? (triplePassed / traces.length * 100).toFixed(1) : "0.0";
  console.log(`- Triple Verification Rate:   ${color(`${tripleRate}%`, "cyan")} (${triplePassed}/${traces.length} traces)`);
  const snapshotFile = resolve(root, ".ritsu/health-snapshots.jsonl");
  const previousSnapshots = existsSync(snapshotFile) ? parseLooseJsonl(snapshotFile) : [];
  const snapshot = { ts: new Date().toISOString(), interceptRate, promoted, currentCoverage, tripleRate, tracesCount: traces.length };
  appendFileSync(snapshotFile, JSON.stringify(snapshot) + "\n");
  console.log(color(`\n✔ Health snapshot saved to .ritsu/health-snapshots.jsonl`, "dim"));
  if (previousSnapshots.length > 0) {
    const prev = previousSnapshots[previousSnapshots.length - 1];
    const prevCoverage = prev?.currentCoverage;
    if (typeof prevCoverage === "string" || typeof prevCoverage === "number") {
      const diff = (parseFloat(currentCoverage) - parseFloat(String(prevCoverage))).toFixed(1);
      const trend = parseFloat(diff) >= 0 ? color(`+${diff}%`, "green") : color(`${diff}%`, "red");
      console.log(`Trend: Coverage moved ${trend} since last check.`);
    }
  }
}

function runDoctorEcosystem(): void {
  const root = detectProjectRoot();
  console.log(color("Ritsu Doctor — Ecosystem Check", "cyan"));
  const result = checkEcosystem(root);
  for (const item of result.items) {
    const icon = item.status === "ok" ? "✔" : item.status === "warn" ? "⚠" : "✖";
    const c = item.status === "ok" ? "green" : item.status === "warn" ? "yellow" : "red";
    console.log(color(`${icon} [${item.id}] ${item.message}`, c));
    if (item.fix) console.log(color(`    fix: ${item.fix}`, "dim"));
  }
  console.log(color(`\nSummary: ${result.passed ? "PASSED" : "FAILED"}`, result.passed ? "green" : "red"));
  if (!result.passed) process.exit(1);
}
