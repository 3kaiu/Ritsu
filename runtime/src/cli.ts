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

export function usage(detailed = false): string {
  const lines = [
    "Usage: ritsu <command> [options]",
    "",
    "User Commands:",
    "  ritsu bootstrap    # 初始化项目 (.mcp.json + ecosystem.json)",
    "  ritsu doctor       # 项目健康检查",
    "  ritsu doctor --ecosystem # MCP 生态验证",
    "  ritsu doctor --signals   # 结构化审计信号 (PASS/WARN/FAIL)",
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
    "  RITSU_LLM_ENABLED=1      # 启用 LLM 规则合成",
    "  RITSU_LLM_API_KEY        # LLM API 密钥",
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
  if (cmd === "mine") { runMine(cmdArgs); return; }
  if (cmd === "cat") { runCat(cmdArgs); return; }

  console.error(color(`Unknown command: ${cmd}`, "red"));
  console.log(usage());
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
