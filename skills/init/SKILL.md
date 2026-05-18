---
name: init
version: "6.1.0"
description: "Ritsu 初始化模块。建立项目基线、生成 AGENTS.md 并配置忽略规则。"
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
- 初始化语义引擎所需的 `.ritsu/` 目录结构。

### 4. 交付摘要与引导

> 引用 `_shared/skill-common-steps.md` Step 4（skill=init）

**引导建议**：
- 初始化完成后，告知用户已采用的人格和识别出的技术栈。
- **示例**：“项目已完成指纹识别（检测到 React + Node.js 全栈架构）。我已就绪，您可以运行 `/r-think` 开始需求评审。”
