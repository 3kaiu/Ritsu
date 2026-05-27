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

> **⚡️ Prompt Topology** — 三段式不可交叉：`anti-patterns.yaml` + `mcp-tools.yaml` + `rules/dev-guardrails.yaml`（Stage 1）→ this file（Stage 2）→ `_suffix: true` 数据（Stage 3，末尾）。

**触发条件**：用户输入 `/r-dev`，或自动路由判定为开发任务。

## 执行流水线

### -1. Prompt Caching 对齐

> 引用 `_shared/skill-common-steps.md` Step -2。优先构建静态基座（`rules/anti-patterns.yaml` + `_shared/mcp-tools.yaml`）后，再进入后续动态流程。

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
- **检查未解决违规**: 在开始新开发前，运行 `ritsu violations` 检查是否有来自之前 session 的 open 违规。如有，优先修复而非新增代码。

#### 2a. 实现对账（单 Agent）

- **P1**: 读取 `design-brief` 或 `design-sheet`。
- **P2**: `ritsu_span_lifecycle action=open`（若尚无 trace）+ 完整对账 `design-sheet` / `coordination-sheet` + 偏好加载。

#### 2b. 🔀 多 Agent 并行路径（P2 可选）

当设计单包含 **3+ 个契约 (C1/C2/C3...)** 或跨多个领域（frontend + backend）时，考虑使用多 Agent 并行实现：

```
ritsu_dispatch_task(agents: 3, cross_review: true)
```

`ritsu_dispatch_task` 会自动：
1. 分析设计单，识别可并行契约
2. 为每个 Agent 构建聚焦提示（只包含其负责的契约）
3. 并行启动 Agent 子进程
4. 收集各 Agent 的产物和质量门禁结果
5. 执行交叉审查（Agent A 审 Agent B 的代码，反之亦然）
6. 检测冲突（同一文件被多处修改、质量结果不一致）
7. 产出统一报告，包含 conflict list 和 divergence rate

**适用场景**:
- 设计单包含多个独立的前端/后端契约（如同时改 API + 前端组件）
- 各契约有明确的责任边界和独立文件
- 变更量大，单 Agent 上下文窗口紧张

**不适用场景**（使用 2a 单 Agent 路径）:
- 契约之间有紧密的文件耦合
- 变更量小（1-2 个文件）
- 简单重构

#### 3. 编码

服从设计文档与领域纪律 (HC-1/HC-2/HC-3)。

#### 4. 质量门禁

- **单 Agent**: `ritsu_run_quality_gates`（已内嵌 policy preflight；传入当前 trace/span/correlation_id）。未通过禁止交付。
- **多 Agent**: 每个 Agent 独立运行质量门禁。`ritsu_dispatch_task` 结果中的 `all_quality_gates_passed` 是所有 Agent 的门禁汇总。若存在 `quality_divergence` 类型的冲突，需人工介入。

#### 4b. 🔍 视觉还原管线（可选，前端 P2 专用）

当项目有设计稿且 `fe-sight` MCP 服务器可用时，在 /r-dev 中整合视觉还原检查。

**完整管线**（三步协作）：

```
Step 1 — 设计分析
  fe_sight_analyze_design(
    figmaKey: "FILE_ID",
    figmaToken: "PAT"
  )
  → 返回结构化设计规范（布局意图 + 颜色 + 字体 + 间距）

Step 2 — 带设计约束的开发
  ritsu_dispatch_task(
    agents: 3,
    design_analysis: <上一步的输出>
  )
  → 每个 Agent 的 prompt 中包含 Visual Design Spec
  → 代码使用设计规范中的精确值

Step 3 — 视觉验证
  fe_sight_check(
    design: "设计图.png",
    url: "http://localhost:5173"
  )
  → 还原度 ≥ 95% → 通过
  → 还原度 < 95% → 修复 → 回到 Step 3
```

fe-sight 是独立 MCP 服务器，在 `.mcp.json` 中注册：

```json
{
  "fe-sight": { "command": "npx", "args": ["-y", "fe-sight"] }
}
```

安装：`npm install fe-sight && npx playwright install chromium`

#### 5. 交付

- 将 gates 结果写入 `dev-report` 结构化字段。
- P2：`emit_event(done)` 与 gates 同 trace/span，且门禁后工作树不变。
- 多 Agent: 确保所有 Agent 的产物均合并到主分支。
- 引导：`/r-review`（P2 强制建议）。

## Gotchas

| What happened | Rule |
|---|---|
| 修了一个 bug，顺带重构了相邻的 3 个函数 | Scope creep — touch only what the task requires |
| "测试通过" 但实际没有运行测试 | Every test claim must point to actual `vitest run` output in this session |
| 新代码用 `let` 但项目偏好 `const` | Always read `.ritsu/preferences.yaml` before writing new code |
| import 了一个不存在的模块 | Always `grep` for module exports before importing |
