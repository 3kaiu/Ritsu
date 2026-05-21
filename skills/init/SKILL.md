---
name: init
version: "6.5.0"
description: "Ritsu 初始化模块。建立项目基线、生成 AGENTS.md 并配置忽略规则。"
author: "3kaiu"
license: "MIT"
homepage: "https://github.com/3kaiu/Ritsu"
tags: ["setup", "onboarding", "mcp-server", "guardrails"]
when_to_use: "/r-init, 初始化, 初始化项目, 新项目"
total_steps: 4
---

# Init: 架构级指纹识别与基线初始化

**触发条件**：用户输入 `/r-init`。

## 执行流水线

### 1. 递归指纹扫描与技术栈感知 (Recursive Fingerprinting)

识别项目的底层架构基因：
- **技术栈识别**：通过递归扫描关键指纹文件（如 `package.json`, `go.mod`, `pubspec.yaml`, `charts/`）确定项目所属的多态领域。
- **工具发现**：自动识别已安装的工具库（如 `ahooks`, `tanstack`, `riverpod`），用于后续的人格微调。
- **架构模式**：识别 Mono-repo 或 Polyglot 结构。

### 2. 架构级 AGENTS.md 生成

建立项目质量与协作基线：
- **技术栈声明**：在 `AGENTS.md` 中显式标注检测到的技术栈组合。
- **Ritsu 运行块**：在 `AGENTS.md` 中生成如下格式的运行时配置块：
  ```html
  <!-- Ritsu Configuration Block -->
  ritsu-version: 5.2.0
  domain: <detected_domain>
  tech_fingerprints:
    - <stack1>
  rules_overrides:
    disable: []
    downgrade: []
  <!-- End Ritsu Block -->
  ```
- **质量门禁注入**：根据技术栈自动填充对应的测试与 Lint 命令。
- **人格锁定**：在 `AGENTS.md` 中预设该项目默认的“资深架构师”人格。

### 3. 工程纯净度与 AI 过程配置

配置 AI 工作空间环境：
- 确保 `.gitignore` 包含 `.ritsu/` 等 AI 过程目录。
- 初始化语义引擎所需的 `.ritsu/` 结构。

### 3.5 生态静默引入（必须）

> [!IMPORTANT]
> **【首次/冷启动引导规则 (Cold Start Gate)】**
> 如果当前 AI 会话中发现 `ritsu_bootstrap_ecosystem` 工具不可用（由于项目刚拉取，Ritsu MCP server 尚未在宿主配置文件中挂载），AI **必须**直接在终端中以 **command** 形式执行以下指令：
> ```bash
> npx -y --package ritsu-mcp-server ritsu bootstrap --host all --include-cursor-hooks
> ```
> 该终端命令会静默下载并执行发布在 npm 的 Ritsu 命令行，自动完成 `.mcp.json`、`.cursor/mcp.json` 的挂载，以及 `AGENTS.md` 和 `.ritsu/` 环境骨架的生成。执行完毕后，提示用户重载 MCP 服务（Claude Code 输入 `/mcp` 刷新，或重启会话）再继续。

1. **若 MCP 工具已成功加载**：直接调用 MCP 工具 **`ritsu_bootstrap_ecosystem`**（默认 `host: claude-code`），写入项目根 **`.mcp.json`** 与 `.ritsu/ecosystem.json`。
2. 提示用户 **重载 Claude Code MCP**（重启会话或 `/mcp`），再运行 `ritsu doctor --ecosystem`；若有 fail 项，在交付摘要中列出 fix。
3. Cursor 用户可选：`ritsu bootstrap --host all`（见 [docs/integrations.md](../docs/integrations.md) 附录 B）。

### 4. 交付摘要与引导

> 引用 `_shared/skill-common-steps.md` Step 4（skill=init）

**引导建议**：
- 初始化完成后，告知用户已采用的人格和识别出的技术栈。
- **示例**：“项目已完成指纹识别（检测到 React + Node.js 全栈架构）。我已就绪，您可以运行 `/r-think` 开始需求评审。”

## Gotchas

| What happened | Rule |
|---|---|
| AGENTS.md 中的 fingerprints 不全，导致 ritsu_exec 白名单过窄 | Scan ALL project files for tech clues, not just manifest files |
| 初始化的 OpenSpec 配置与项目实际结构不匹配 | Verify project structure matches inferred domain before writing config |
| 指纹识别漏掉了 monorepo 子包 | Walk subdirectories for additional manifest files |
