#!/usr/bin/env node

/**
  * Ritsu Setup Wizard
  *
  * 一键式智能安装与宿主配置脚本。
  * 自动化完成：环境检测 -> 依赖安装 -> TS构建 -> 版本对齐 -> MCP注册 -> 生态诊断。
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
  console.log(`\n${COLORS.cyan}${COLORS.bold}=== [Ritsu Setup] ${title} ===${COLORS.reset}\n`);
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

// 0. Environment preflight check
console.log(`${COLORS.cyan}${COLORS.bold}==================================================`);
console.log("     律 (Ritsu) — 工业级 AI 协同引擎智能配置向导");
console.log(`==================================================${COLORS.reset}`);

const nodeVersion = process.versions.node;
const majorVersion = parseInt(nodeVersion.split(".")[0], 10);
console.log(`${COLORS.dim}Node.js 版本检测: ${nodeVersion}${COLORS.reset}`);

if (majorVersion < 20) {
  console.error(`\n${COLORS.red}${COLORS.bold}✖ 错误: Ritsu 引擎要求 Node.js 版本必须 >= 20.0.0。${COLORS.reset}`);
  console.error(`当前版本为: ${nodeVersion}，请升级 Node.js 后重试。`);
  process.exit(1);
}

if (majorVersion < 22) {
  console.log(`\n${COLORS.yellow}⚠ 建议: Ritsu 推荐使用 Node.js 版本 >= 22.0.0 (当前: v${nodeVersion})。已跳过拦截以继续配置。${COLORS.reset}\n`);
} else {
  console.log(`${COLORS.green}✔ Node.js 环境检测合格 (v${nodeVersion})${COLORS.reset}`);
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

// 1. Install dependencies
logHeader("安装运行时依赖 (runtime dependencies)");
if (skipInstall) {
  console.log(`${COLORS.green}✔ 依赖包没有发生任何变更 (Hash 匹配)，已自动跳过安装以节省时间！${COLORS.reset}`);
} else {
  runCommand("npm", ["install"], { cwd: resolve(projectRoot, "runtime") });
  if (currentHash) {
    if (!existsSync(ritsuDir)) {
      mkdirSync(ritsuDir, { recursive: true });
    }
    writeFileSync(cachePath, JSON.stringify({ hash: currentHash, ts: new Date().toISOString() }, null, 2), "utf8");
  }
  console.log(`${COLORS.green}✔ 依赖安装完成。${COLORS.reset}`);
}

// 2. Build runtime TS to JS
logHeader("编译 TypeScript 源代码 (TypeScript build)");
runCommand("npm", ["run", "build", "--prefix", "runtime"]);
console.log(`${COLORS.green}✔ TypeScript 编译成功，输出至 runtime/dist/。${COLORS.reset}`);

// 3. Align all configuration and rule versions
logHeader("校验并自动对齐全仓库版本 (version alignment)");
runCommand("node", ["runtime/version-check.js", "--write"]);
console.log(`${COLORS.green}✔ 全局版本自动同步校准完毕。${COLORS.reset}`);

// 4. Auto bootstrap MCP servers
logHeader("自动挂载配置 Ritsu MCP Server (MCP bootstrap)");
runCommand("node", ["runtime/dist/cli.js", "bootstrap", "--host", "all", "--include-cursor-hooks"]);
console.log(`${COLORS.green}✔ MCP 宿主配置注册完成。${COLORS.reset}`);

// 4.5 Git pre-commit hook setup
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

// 5. Run doctor ecosystem diagnosis
logHeader("运行环境与生态就绪度全面诊断 (doctor ecosystem)");
console.log(`${COLORS.dim}诊断生态组件、规则目录、ast-grep CLI 等依赖状态：${COLORS.reset}`);
const doctorResult = spawnSync("node", ["runtime/dist/cli.js", "doctor", "--ecosystem"], {
  cwd: projectRoot,
  stdio: "inherit",
  shell: true,
});

if (doctorResult.status !== 0) {
  console.log(`\n${COLORS.yellow}⚠ 警告: 诊断发现非核心项告警，请阅读上方输出以补充可选依赖。${COLORS.reset}`);
} else {
  console.log(`\n${COLORS.green}${COLORS.bold}✔ Ritsu 生态检测全部合格！环境已完全就绪。${COLORS.reset}`);
}

// 6. Print next steps instructions
console.log(`\n${COLORS.green}${COLORS.bold}==================================================`);
console.log("🎉 律 (Ritsu) AI 协同引擎安装与配置成功！");
console.log(`==================================================${COLORS.reset}`);
console.log(`\n${COLORS.bold}👉 后续如何载入 AI 助手？${COLORS.reset}`);
console.log(`  ${COLORS.cyan}• Claude Code 用户${COLORS.reset}: 请在当前会话中键入 ${COLORS.bold}/mcp${COLORS.reset} 刷新，或执行重启会话。`);
console.log(`  ${COLORS.cyan}• Cursor 用户${COLORS.reset}: 偏好设置中的 MCP 菜单已自动注入 Ritsu 项，您只需点击 'Reload' 重启服务。`);
console.log(`  ${COLORS.cyan}• 命令行伴随工具${COLORS.reset}: 可在根目录下直接调用 ${COLORS.bold}npm run doctor${COLORS.reset} 进行定期自检。`);
console.log(`\n如有代码变更，直接在根目录执行 ${COLORS.bold}npm run update${COLORS.reset} 即可极速完成增量自愈构建与重新装载！\n`);
