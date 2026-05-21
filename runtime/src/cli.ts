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

export function usage(): string {
  return [
    "ritsu cat <cid>            # 按 correlation_id 展示一条任务链路的 ctx 事件（彩色）",
    "ritsu cat --recent <N>     # 展示最近 N 条 ctx 事件",
    "ritsu cat --file <path>    # 直接指定 ctx jsonl 文件路径",
    "ritsu trace <id>           # 展示 Trace 链路和 Span 树（自动兼容 legacy CID）",
    "ritsu trace --open         # 展示当前所有未关闭的 Trace",
    "ritsu trace --check-triple  # 验证最新 Trace 的三方一致性 (Design ↔ Dev ↔ Assurance)",
    "ritsu doctor               # 项目健康检查 (版本对齐、环境校验、锁文件)",
    "ritsu doctor --health      # 输出核心健康度 4 指标与趋势分析",
    "ritsu doctor --similar-violations [--since 30d] [--query text]  # 离线相似违规检索（Jaccard，无 embedding）",
    "ritsu doctor --ecosystem          # 校验 MCP/OpenSpec/ast-grep 生态可达性",
    "ritsu bootstrap [--host claude-code|cursor|all]  # 默认写入 .mcp.json + .ritsu/ecosystem.json",
    "ritsu export [--out path]  # 导出当月任务摘要为 Markdown 报告",
    "ritsu sync push            # 将本地 .ritsu/ 约束状态推送至隔离的 Git 分支",
    "ritsu sync pull            # 从远端拉取 .ritsu/ 约束状态",
    "ritsu mine --report [--days 7]  # 离线挖掘偏好，生成 Mining Sheet",
    "ritsu mine --promote <id>  # 将 Mining Sheet 中的提议晋升为正式偏好",
    "ritsu mine --auto [--days 7]   # 自动分析人类修正，合成并晋升编码风格偏好规则",
    "ritsu mine --reconcile     # 强制对账并编译 preferences 为 ast-grep 规则",
    "",
    "  think -> dev -> test/hunt -> review",
    "\nENV:",
    "  RITSU_PROJECT_ROOT       # 项目根目录（默认当前目录）",
  ].join("\n");
}

export function main() {
  const args = process.argv.slice(2);
  const helpRequested = args.length === 0 || args.includes("-h") || args.includes("--help");

  if (helpRequested) { console.log(usage()); return; }

  const [cmd, ...cmdArgs] = args;

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
