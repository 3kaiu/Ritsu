---
name: think
version: "3.8.0"
description: "Ritsu 主入口。用于需求审核、边界澄清、风险判断、契约确认和实施清单生成。"
when_to_use: "/r-think, 需求审核, 方案判断, 怎么做, 要不要做, 分析一下, 看看这个 PRD"
total_steps: 5
fast_mode:
  skip_steps: [2]
  skip_artifacts: false
  self_test: null
  description: "跳过深度风险扩展，只输出足够支持后续开发的边界、契约和实施清单"
hard_constraints:
  - id: HC-1
    rule: "设计输出必须服务于后续开发与验证，禁止制造与当前任务无关的分析负担"
    severity: FATAL
  - id: HC-2
    rule: "Handoff 文件不得包含占位符"
    severity: FATAL
  - id: HC-3
    rule: "边界不清时必须明确指出缺口，禁止假装已经澄清"
    severity: FATAL
---

# Think: 需求审核与边界澄清入口

**触发条件**：用户输入 `/r-think`，或 `review / hunt / dev` 回流要求重新确认需求边界时调用。

## 执行流水线

> 若 runtime 可用，先用 `ritsu_run_flow(flow_id="think-clarify")` 建立执行骨架；AI 主要处理 `confirm_goal / draft_think_artifacts` 这类判断位，并在每个判断位结束后用 `ritsu_apply_flow_decision` 回写。

### 1. 领域解析与输入对账

> 引用 `_shared/skill-common-steps.md` Step 1

读取当前输入来源：

- 用户当前需求文本
- `think-ticket`（兼容旧名 `intake-ticket`）
- `think-plan`（兼容旧名 `delivery-plan`）
- 最近的 `review-report`（兼容旧名 `assurance-report`）
- `review-advice`（兼容旧名 `release-advice`）
- 主产物不足时，再补充 `handoff / diagnosis / review-stamp`

若需要检索 `.ritsu/` 历史记录，默认先查 `layers=["primary"]`，不足时再扩展到 `layers=["evidence"]`。

### 2. 需求审核

`[Step 1 Complete]` 后进入步骤 2。

必须回答：

- 当前目标是什么
- 这次到底做什么
- 这次明确不做什么
- 风险等级是什么
- 还缺什么信息

### 3. 契约与方案判断

`[Step 2 Complete]` 后进入步骤 3。

先锁定契约，再讨论实现：

- backend / fullstack：接口和数据契约
- frontend / fullstack：组件和状态契约

如果有多种方案，只保留足够支持决策的对比。

### 4. 审核产物输出

`[Step 3 Complete]` 后进入步骤 4。

应优先写主产物：

- `think-ticket`：沉淀需求理解、风险、下一步路径
- `think-plan`：当边界、实施步骤、验证计划需要明确落盘时写入

只有在以下情况之一成立时，再额外写 `handoff`：

- 需要更细的接口 / 数据 / 组件契约
- 需要给 `dev` 提供可直接执行的实施清单
- `critical` 任务需要可审计的设计证据

### 5. 审核摘要

`[Step 4 Complete]` 后进入步骤 5。

> 引用 `_shared/skill-common-steps.md` Step 4（skill=think）

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=think, artifact=.ritsu/think-ticket-{ts}.md 或 .ritsu/think-plan-{ts}.md；兼容旧名前缀）
