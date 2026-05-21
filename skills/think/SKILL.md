---
name: think
version: "6.5.0"
description: "Ritsu 需求分析入口。根据任务等级产出对应深度的设计文档。"
author: "3kaiu"
license: "MIT"
homepage: "https://github.com/3kaiu/Ritsu"
tags: ["design", "architecture", "mcp-server", "openspec"]
when_to_use: "/r-think, 需求审核, 方案判断, 怎么做, 看看这个需求"
total_steps: 4
---

# Think: 自适应需求分析与设计

**触发条件**：用户输入 `/r-think`，或自动路由判定为需要设计的任务。

## 执行流水线

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

**Preflight 已自动完成** ctx/agents/OpenSpec（P2）；勿再单独调用 `ritsu_sync_openspec_contracts`。契约说明见 [_shared/openspec-contract-bridge.md](../_shared/openspec-contract-bridge.md)。

---

### 🟡 Standard 路径 (P1)

1. **轻量工程分析**: 基于 `context_pack` 确认目标、关键改动点、实施步骤。
2. **产出 `design-brief`**: 使用轻量模板，包含目标 + 关键改动 + 实施清单 + 验证。
3. **引导**: "设计简报已就绪。建议运行 `/r-dev` 开始实现。"

---

### 🔴 Critical 路径 (P2)

1. **深度架构审查**: 仅阅读 `context_pack` 与 design 相关路径；禁止无差别全库扫描（见 [docs/integrations.md](../docs/integrations.md)）。
   - 通用 / Frontend / Backend / Mobile 专项见领域 YAML。
2. **产出设计产物**:
   - 若 preflight 已产出 OpenSpec 桥接 sheet：以其为契约 SoT，**勿**再写第二份完整 narrative design-sheet。
   - 单人非 OpenSpec：`design-sheet` + `contracts[]` 必填。
   - Multi-Agent：`ritsu_open_span` + `coordination-sheet`。
3. **引导**: "架构设计已就绪。建议 `/r-dev`。"
