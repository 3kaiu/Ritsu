---
name: init
version: "4.0.0"
description: "Ritsu 初始化模块。建立项目基线、生成 AGENTS.md 并配置忽略规则。"
when_to_use: "/r-init, 初始化, 初始化项目, 新项目"
total_steps: 4
---

# Init: 项目初始化与基线建立

**触发条件**：用户输入 `/r-init`。

## 执行流水线

### 1. 项目全貌扫描

识别项目核心信息：
- 技术栈 (Frontend/Backend/Infra)
- 架构模式与关键目录
- 现有的质量门禁 (Lint/Test 命令)

### 2. AGENTS.md 生成与注入

根据扫描结果建立项目指纹：
- 产出符合 v4.0 规范的 `AGENTS.md`。
- 如果已存在，执行差异对比并建议合并或覆盖。

### 3. 环境与忽略规则配置

确保工程纯净度：
- 配置 `.gitignore`，将 `.ritsu/` 等 AI 过程目录纳入忽略。
- 建立 `.ritsu/` 基础目录结构。

### 4. 交付摘要与引导

> 引用 `_shared/skill-common-steps.md` Step 4（skill=init）

**引导建议**：
- 初始化完成后，明确告知用户基线已建立。
- **示例**：“项目初始化已完成。如果你有新的功能需求，请运行 `/r-think` 开始分析。”
