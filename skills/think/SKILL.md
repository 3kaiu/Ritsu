---
name: think
version: "3.8.0"
description: "Ritsu 交付设计子模块。为 deliver 提供范围澄清、验收标准和实现边界，不再作为主产品入口。"
when_to_use: "/r-think, 设计方案, 怎么做, 要不要做, 分析一下, 看看这个 PRD"
total_steps: 5
fast_mode:
  skip_steps: [2]
  skip_artifacts: false
  self_test: null
  description: "跳过深度风险扩展，只输出足够支持交付的边界、契约和实施清单"
hard_constraints:
  - id: HC-1
    rule: "设计输出必须服务于交付，禁止为了完整性制造与当前任务无关的分析负担"
    severity: FATAL
  - id: HC-2
    rule: "Handoff 文件不得包含占位符"
    severity: FATAL
  - id: HC-3
    rule: "若任务已处于 quick 模式且边界清晰，不得强行升级为重设计流程"
    severity: FATAL
---

# Think: Deliver 内部设计子模块 (Delivery Design Module)

**触发条件**：用户输入 `/r-think`，或 `deliver.standard / deliver.critical` 需要补充设计边界时调用。

> 该模块现在是 `deliver` 的内部阶段，不是产品一线入口。

## 执行流水线

### 1. 领域解析与输入对账

> 引用 `_shared/skill-common-steps.md` Step 1

读取当前输入来源：

- intake-ticket
- 最近的 assurance-report / review-stamp / diagnosis（若存在）
- 当前需求文本

如果本次来自 assure 失败回流，优先回答熔断反馈中的关键问题。

### 2. 范围澄清

`[Step 1 Complete]` 后进入步骤 2。

输出最小必要设计结论：

- 目标范围（In Scope）
- 明确不做什么（Out of Scope）
- 验收标准
- 主要风险边界

只有 `critical` 任务才默认展开更重的风险矩阵；`standard` 任务只保留和当前交付直接相关的风险。

### 3. 契约与方案选择

`[Step 2 Complete]` 后进入步骤 3。

先锁定契约，再讨论实现：

- backend / fullstack：接口和数据契约
- frontend / fullstack：组件和状态契约

如存在多种实现路径，只给出足以支持交付决策的方案对比：

- 方案 A
- 方案 B
- 推荐原因
- 复杂度与侵入度

### 4. Handoff 输出

`[Step 3 Complete]` 后进入步骤 4。

调用 **`ritsu_write_artifact`**（type=handoff）写入交付设计产物，内容至少包含：

- 边界与依赖
- 核心契约
- 验收标准
- 实施清单

Handoff 的职责是减少后续 `dev` 的临场决策，而不是生成论文式设计文档。

它和 `intake-ticket` 的分工必须清晰：

- `intake-ticket` 负责需求受理、风险分级、执行路径
- `handoff` 负责实施边界、契约细化、任务拆解

### 5. 交付摘要

`[Step 4 Complete]` 后进入步骤 5。

> 引用 `_shared/skill-common-steps.md` Step 4（skill=think）

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=think, artifact=.ritsu/handoff-{slug}.md）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=think）
