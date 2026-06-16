---
name: think
version: "6.5.0"
description: "Ritsu 需求分析入口。根据任务等级产出对应深度的设计文档。"
author: "3kaiu"
license: "MIT"
homepage: "https://github.com/3kaiu/Ritsu"
tags: ["design", "architecture", "mcp-server"]
when_to_use: "/r-think, 需求审核, 方案判断, 怎么做, 看看这个需求"
total_steps: 4
---

# Think: 自适应需求分析与设计

> **⚡️ Prompt Topology** — 三段式不可交叉：`anti-patterns.yaml` + `mcp-tools.yaml`（Stage 1 Static Prefix）→ this file（Stage 2 Skill Guide）→ `_suffix: true` 数据（Stage 3 Suffix Zone，末尾）。

**触发条件**：用户输入 `/r-think`，或自动路由判定为需要设计的任务。

## 执行流水线

### -1. Prompt Caching 对齐

> 引用 `_shared/skill-common-steps.md` Step -2。优先构建静态基座（`rules/anti-patterns.yaml` + `_shared/mcp-tools.yaml`）后，再进入后续动态流程。

### 0. 分级判定

> 引用 `_shared/skill-common-steps.md` Step 0

- **Micro (P0)**: 告知用户"该任务无需设计，建议直接 `/r-dev`"。结束。
- **Standard (P1)**: 进入轻量分析路径。
- **Critical (P2)**: 进入深度分析路径。

### 1. 生态 Preflight（必须，一步代替多工具）

调用 **`ritsu_preflight`**：
- `stage: think`
- `tier`: 上一步判定结果（P0/P1/P2）
- `task_summary`: 用户诉求一句话（P2 必填，供 OpenSpec propose）

若返回 `ok: false`，根据 `context_pack` 修复后重试。禁止跳过。

**Preflight 已自动完成** ctx/agents/契约同步（P2）；架构指纹已加载（见 AGENTS.md Architecture Block），模块边界和依赖规则可供参考。

---

### 🟡 Standard 路径 (P1)

1. **轻量工程分析**: 基于 `context_pack` 确认目标、关键改动点、实施步骤。
2. **产出 `design-brief`**: 使用轻量模板，包含目标 + 关键改动 + 实施清单 + 验证。
3. **引导**: "设计已就绪。建议运行 `/r-dev`。"

---

### 🔴 Critical 路径 (P2)

1. **深度架构审查**: 仅阅读 `context_pack` 与 design 相关路径；禁止无差别全库扫描（见 [docs/integrations.md](../docs/integrations.md)）。
   - 通用 / Frontend / Backend / Mobile 专项见领域 YAML。
2. **产出设计产物**:
   - 若 preflight 已产出 OpenSpec 桥接 sheet：以其为契约 SoT，**勿**再写第二份完整 narrative design-sheet。
   - 单人非 OpenSpec：`design-sheet` + `contracts[]` 必填。
   - Multi-Agent：`ritsu_span_lifecycle action=open` + `coordination-sheet`。

### 🔵 MasterGo D2C 设计稿还原集成 (P1 & P2 均适用)

如果需求或设计目标中提供了 MasterGo 链接（如 `https://mastergo.com/file/...` 或短链）：
1. **自动调用 D2C 流程**：你必须按照 [d2c skill](file:///Users/edy/CascadeProjects/Ritsu/skills/d2c/SKILL.md) 自动执行还原与 spec 编译：
   - 首先调用 `mcp__getDesignSections` 获取设计稿 overview。
   - 并行批量调用 `mcp__getDesignSections` (带 `sectionIndex`)、`mcp__getDesignSvgs` 和 `mcp__getDesignTexts` 获取完整资源与 DSL。
   - 调用 `ritsu_d2c_compile` 编译生成 `d2c-spec.json`。
2. **集成设计契约**：设计稿 `design-sheet.md` (或 `design-brief.md`) **必须显式引用并链接** `d2c-spec.json`（如 `[d2c-spec.json](file:///Users/edy/CascadeProjects/Ritsu/d2c-spec.json)`），且必须在整体设计中阐明需要还原的结构及交互状态，以通过 `DA-7` 门禁检查。
3. **完成整体设计**：只有在 D2C 编译通过、spec 生成并被设计文档集成引用后，才可以进入 `/r-dev` 阶段。

### 架构上下文
Preflight 已自动加载架构指纹（见 AGENTS.md Architecture Block）。分析时优先参考该块的模块边界和依赖规则。

3. **引导**: "架构设计已就绪。建议 `/r-dev`。"

## Gotchas

| What happened | Rule |
|---|---|
| 在 monorepo 根目录设计，但实际子包架构完全不同 | Always `pwd` + read root `package.json` workspaces before designing |
| 用了 3 轮对话才确认数据库选型 | Bundle all clarifying questions into one turn |
| 设计文档留了 5 个 "TODO: 待定" | Plans must be decision-complete with zero placeholders |
| AI 在微服务项目中设计了单体架构 | Always check AGENTS.md domain + existing design artifacts first |
