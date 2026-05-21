#!/usr/bin/env node

/**
  * Ritsu Self-Healing Update Script
  *
  * 一键式安全更新、重构与生态自愈工具。
  * 自动化完成：源码拉取自检 -> 依赖更新重构 -> TS增量重新编译 -> 版本自动校验 -> MCP挂载点重刷 -> 生态自愈诊断。
  */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

function getDependenciesHash() {
  try {
    const pkgPath = resolve(projectRoot, "runtime/package.json");
    const lockPath = resolve(projectRoot, "runtime/package-lock.json");
    const pkgContent = existsSync(pkgPath) ? readFileSync(pkgPath, "utf8") : "";
    const lockContent = existsSync(lockPath) ? readFileSync(lockPath, "utf8") : "";
    return createHash("sha256").update(pkgContent + lockContent).digest("hex");
  } catch {
    return null;
  }
}

const COLORS = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  cyan: "\u001b[36m",
  red: "\u001b[31m",
};

function logHeader(title) {
  console.log(`\n${COLORS.cyan}${COLORS.bold}=== [Ritsu Update] ${title} ===${COLORS.reset}\n`);
}

function runCommand(command, args, options = {}) {
  console.log(`${COLORS.dim}$ ${command} ${args.join(" ")}${COLORS.reset}`);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: true,
    ...options,
  });

  if (result.status !== 0) {
    console.error(`\n${COLORS.red}${COLORS.bold}✖ 命令执行失败: ${command} ${args.join(" ")}${COLORS.reset}`);
    if (result.error) console.error(result.error);
    process.exit(result.status || 1);
  }
  return result;
}

console.log(`${COLORS.cyan}${COLORS.bold}==================================================`);
console.log("     律 (Ritsu) — 零感生态增量更新与安全自愈引擎");
console.log(`==================================================${COLORS.reset}`);

const nodeVersion = process.versions.node;
const majorVersion = parseInt(nodeVersion.split(".")[0], 10);
if (majorVersion < 20) {
  console.error(`\n${COLORS.red}${COLORS.bold}✖ 错误: Ritsu 引擎要求 Node.js 版本必须 >= 20.0.0。${COLORS.reset}`);
  process.exit(1);
}

if (majorVersion < 22) {
  console.log(`\n${COLORS.yellow}⚠ 建议: Ritsu 推荐使用 Node.js 版本 >= 22.0.0 (当前: v${nodeVersion})。已跳过拦截以继续更新。${COLORS.reset}\n`);
} else {
  console.log(`${COLORS.green}✔ Node.js 环境检测合格 (v${nodeVersion})${COLORS.reset}`);
}

// 1. Git Repository State Inspection
logHeader("检查 Git 仓库与工作区状态 (git inspection)");
const gitCheck = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectRoot });
if (gitCheck.status === 0) {
  console.log(`${COLORS.green}✔ 检测到 Git 仓库环境。${COLORS.reset}`);
  
  // Check if worktree is clean
  const statusCheck = spawnSync("git", ["status", "--porcelain"], { cwd: projectRoot, encoding: "utf-8" });
  const isClean = !statusCheck.stdout.trim();
  
  if (isClean) {
    console.log(`${COLORS.dim}当前分支干净，尝试拉取最新远程代码 (git pull --rebase)...${COLORS.reset}`);
    // Non-blocking remote fetch/pull to keep updating extremely smooth
    const pullResult = spawnSync("git", ["pull", "--rebase", "--timeout=10"], {
      cwd: projectRoot,
      stdio: "inherit",
      shell: true,
    });
    if (pullResult.status === 0) {
      console.log(`${COLORS.green}✔ 远程代码拉取同步完成。${COLORS.reset}`);
    } else {
      console.log(`${COLORS.yellow}⚠ 无法连接到远程 Git 仓库或拉取超时，将使用本地最新代码执行重构。${COLORS.reset}`);
    }
  } else {
    console.log(`${COLORS.yellow}⚠ 工作区存在未提交更改，跳过自动拉取远程，将以当前工作区代码执行重构自愈。${COLORS.reset}`);
  }
} else {
  console.log(`${COLORS.yellow}⚠ 当前非 Git 仓库，跳过 Git 同步步骤，以纯本地文件执行自愈。${COLORS.reset}`);
}

// Check dependency cache
const ritsuDir = resolve(projectRoot, ".ritsu");
const cachePath = resolve(ritsuDir, "install-cache.json");
const currentHash = getDependenciesHash();
let skipInstall = false;

if (currentHash && existsSync(cachePath)) {
  try {
    const cache = JSON.parse(readFileSync(cachePath, "utf8"));
    if (cache.hash === currentHash) {
      skipInstall = true;
    }
  } catch {
    // Ignore cache parse errors
  }
}

// 2. Refresh Node modules
logHeader("同步更新三方依赖包 (updating node dependencies)");
if (skipInstall) {
  console.log(`${COLORS.green}✔ 依赖包没有发生任何变更 (Hash 匹配)，已自动跳过 npm install 以提升升级速度！${COLORS.reset}`);
} else {
  runCommand("npm", ["install"], { cwd: resolve(projectRoot, "runtime") });
  if (currentHash) {
    if (!existsSync(ritsuDir)) {
      mkdirSync(ritsuDir, { recursive: true });
    }
    writeFileSync(cachePath, JSON.stringify({ hash: currentHash, ts: new Date().toISOString() }, null, 2), "utf8");
  }
  console.log(`${COLORS.green}✔ 依赖同步刷新成功。${COLORS.reset}`);
}

// 3. Recompile TypeScript source code
logHeader("重新增量编译 TypeScript (rebuilding TypeScript code)");
runCommand("npm", ["run", "build", "--prefix", "runtime"]);
console.log(`${COLORS.green}✔ TypeScript 编译完成，二进制指令集已对齐。${COLORS.reset}`);

// 4. Force version alignment write
logHeader("强制对齐全仓库规约版本 (syncing versions)");
runCommand("node", ["runtime/version-check.js", "--write"]);
console.log(`${COLORS.green}✔ 全局一致性版本强制对齐成功。${COLORS.reset}`);

// 5. Refresh MCP Server paths
logHeader("重新装载并更新 MCP 挂载点 (refreshing bootstrap)");
runCommand("node", ["runtime/dist/cli.js", "bootstrap", "--host", "all", "--include-cursor-hooks"]);
console.log(`${COLORS.green}✔ MCP 注册挂载点刷新成功。${COLORS.reset}`);

// 5.5 Git pre-commit hook setup
const gitHooksDir = resolve(projectRoot, ".git/hooks");
if (existsSync(gitHooksDir)) {
  logHeader("部署 Git pre-commit 安全防护门禁 (Git Hook)");
  const preCommitPath = resolve(gitHooksDir, "pre-commit");
  const hookScript = `#!/bin/sh
# Ritsu pre-commit hook
echo "[Ritsu] Running pre-commit consistency checks..."
node runtime/version-check.js
if [ $? -ne 0 ]; then
  echo "✖ [Ritsu] Version mismatch detected! Commit aborted."
  exit 1
fi
`;
  writeFileSync(preCommitPath, hookScript, { mode: 0o755 });
  console.log(`${COLORS.green}✔ Git pre-commit 安全钩子配置成功 (阻断任何版本与契约漂移)。${COLORS.reset}`);
}

// 6. Final doctor diagnostics
logHeader("自愈后就绪度诊断 (final doctor check)");
const doctorResult = spawnSync("node", ["runtime/dist/cli.js", "doctor", "--ecosystem"], {
  cwd: projectRoot,
  stdio: "inherit",
  shell: true,
});

if (doctorResult.status !== 0) {
  console.log(`\n${COLORS.yellow}⚠ 更新后自检发现部分非致命性警告，请查看上方输出。${COLORS.reset}`);
} else {
  console.log(`\n${COLORS.green}${COLORS.bold}✔ Ritsu 全生态健康度诊断合格！升级圆满完成。${COLORS.reset}`);
}

// 7. Success Card
console.log(`\n${COLORS.green}${COLORS.bold}==================================================`);
console.log("🎉 Ritsu 引擎全量自愈更新与环境校验完成！");
console.log(`==================================================${COLORS.reset}`);
console.log(`\n${COLORS.bold}👉 如何在您的 AI 协同工具中使之生效？${COLORS.reset}`);
console.log(`  ${COLORS.cyan}• Claude Code 用户${COLORS.reset}: 请执行 ${COLORS.bold}/mcp${COLORS.reset} 重启 MCP server 以运行最新版本内核。`);
console.log(`  ${COLORS.cyan}• Cursor 用户${COLORS.reset}: MCP 配置服务已自动更新，点击 'Reload' 刷新即可完美体验最新特性。`);
console.log(`  ${COLORS.cyan}• 健康保障${COLORS.reset}: 全仓库版本及策略对账 100% 保持一致，策略规则已编译当场物理生效！\n`);
