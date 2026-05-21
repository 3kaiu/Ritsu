---
name: dev
version: "6.5.0"
description: "Ritsu 开发实现入口。根据任务等级自动选择最优执行路径。"
author: "3kaiu"
license: "MIT"
homepage: "https://github.com/3kaiu/Ritsu"
tags: ["coding", "implementation", "mcp-server", "quality-gates"]
when_to_use: "/r-dev, 写代码, 开发, 修复 bug, 开始实现, 改一下, 调整"
total_steps: 5
---

# Dev: 自适应代码实现与交付

**触发条件**：用户输入 `/r-dev`，或自动路由判定为开发任务。

## 执行流水线

### 0. 分级判定

> 引用 `_shared/skill-common-steps.md` Step 0

判定完成后，按等级分叉。

---

### 🟢 Micro 路径 (P0)

**准入条件**: 变更 < 20 LoC，单文件，无逻辑架构变动。

1. **直接编码**: 遵循 HC-1 / HC-2。
2. **质量验证**: lint 或 type check。
3. **一句话回复** — 无产物，无 ctx。

---

### 🟡 Standard / 🔴 Critical 路径 (P1/P2)

#### 1. Preflight（必须）

`ritsu_preflight(stage: dev)` — 自动串联 ctx、design 产物列表、changed_files、diff、**policy+ast-grep**、架构漂移检测。

架构上下文参考 AGENTS.md Architecture Block（模块边界和依赖规则）。

- `ok: false` → 按 `context_pack.policy.violations` 修复后重试；**禁止**写 dev-report 或进入 review。
- fatal/hard_stop 必须清零。

#### 2. 实现对账

- **P1**: 读取 `design-brief` 或 `design-sheet`。
- **P2**: `ritsu_span_lifecycle action=open`（若尚无 trace）+ 完整对账 `design-sheet` / `coordination-sheet` + 偏好加载。

#### 3. 编码

服从设计文档与领域纪律 (HC-1/HC-2/HC-3)。

#### 4. 质量门禁

`ritsu_run_quality_gates`（已内嵌 policy preflight；传入当前 trace/span/correlation_id）。未通过禁止交付。

#### 5. 交付

- 将 gates 结果写入 `dev-report` 结构化字段。
- P2：`emit_event(done)` 与 gates 同 trace/span，且门禁后工作树不变。
- 引导：`/r-review`（P2 强制建议）。

## Gotchas

| What happened | Rule |
|---|---|
| 修了一个 bug，顺带重构了相邻的 3 个函数 | Scope creep — touch only what the task requires |
| "测试通过" 但实际没有运行测试 | Every test claim must point to actual `vitest run` output in this session |
| 新代码用 `let` 但项目偏好 `const` | Always read `.ritsu/preferences.yaml` before writing new code |
| import 了一个不存在的模块 | Always `grep` for module exports before importing |
