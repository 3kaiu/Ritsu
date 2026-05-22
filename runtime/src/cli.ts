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


// Re-exports for backward compatibility (used by tests)
export {
  findLatestCtxFile, parseJsonl, parseLooseJsonl,
  readCoveragePct, readRuntimeMetadataFromPackageJson,
  getArtifactTypes, getLatestTraceId, normalizeTraceId,
  getTraceEvents, getOpenTraceIds, countTripleVerifiedTraces,
  buildTraceSpanForest, summarizeTasks,
  formatSkill, formatEvent,
} from "./cli/shared.js";
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
    "  ritsu bootstrap    # 初始化项目 (.mcp.json + ecosystem.json)",
    "  ritsu doctor       # 项目健康检查",
    "  ritsu doctor --ecosystem # MCP 生态验证",
    "  ritsu doctor --signals   # 结构化审计信号 (PASS/WARN/FAIL)",
    "  ritsu doctor --ai        # AI 工具配置检查",
    "  ritsu trust        # 初始化/覆盖 HMAC 密钥",
    "  ritsu verify <id>  # 校验指定 Trace 的 HMAC 签名",
    "  ritsu mine --auto   # 自动偏好学习",
    "  ritsu status        # 当前项目状态一览",
    "",
    "Ritsu CLI — 4 阶段工作流: think → dev → review → hunt",
    "",
  ];

  if (detailed) {
    lines.push(
      "Development / Debug:",
      "  ritsu cat <cid>      # 查看 ctx 事件",
      "  ritsu trace <id>     # Trace 链路与 Span 树",
      "  ritsu export         # 导出月度任务报告",
      "  ritsu sync push/pull # .ritsu Git 同步",
      "  ritsu mine --auto    # 自动偏好学习",
      "",
    );
  }

  lines.push(
    "ENV:",
    "  RITSU_PROJECT_ROOT       # 项目根目录（默认当前目录）",
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
