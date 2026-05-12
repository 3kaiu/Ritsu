---
name: dev
version: "3.8.0"
description: "Ritsu 主入口。根据已确认边界完成实现、局部验证和交付回执，是默认开发入口。"
when_to_use: "/r-dev, 写代码, 开发, 修复 bug, 开始实现"
total_steps: 6
fast_mode:
  skip_steps: [2, 5]
  skip_artifacts: true
  self_test: "ritsu_run_quality_gates"
  description: "在 quick 交付中降低交互密度，保留实现与基本验证"
hotfix_mode:
  description: "仅适用于极小改动，仍须执行最小验证"
  rules:
    - "仅适用于 ≤1 文件且 ≤10 行的确定性微变更"
    - "仍须执行最小验证"
hard_constraints:
  - id: HC-1
    rule: "引用或调用外部标识符前必须验证其真实存在，并确保调用签名对齐"
    severity: FATAL
  - id: HC-2
    rule: "交付物不得包含占位符"
    severity: FATAL
  - id: HC-3
    rule: "实现必须服从 think 已确认的边界，不得擅自扩大范围"
    severity: FATAL
---

# Dev: 实现主入口

**触发条件**：用户输入 `/r-dev`，或 `think / hunt / test` 已明确下一步需要进入实现时调用。

## 执行流水线

> 若 runtime 可用，先用 `ritsu_run_flow(flow_id="dev-delivery")` 建立执行骨架；AI 主要处理实现动作和 `dev-report` 判断位，并在每个判断位结束后用 `ritsu_apply_flow_decision` 回写。

### 1. 领域解析与目标绑定

> 引用 `_shared/skill-common-steps.md` Step 1

优先绑定当前交付目标：

- `think-plan / think-ticket / dev-report`（兼容旧名 `delivery-plan / intake-ticket / delivery-report` 同样可读）
- `handoff`
- `diagnosis`
- 当前需求文本

若无明确设计产物，可继续执行，但必须在交付摘要中标注“无上游设计溯源”。

### 2. 编码边界与规则加载

`[Step 1 Complete]` 后进入步骤 2。

读取项目级规则覆盖和领域纪律，作为本次实现约束。

- `quick`：优先直接实现，保持改动集中
- `standard / critical`：严格服从 `think` 已确认的目标、范围、验证计划和回滚假设

### 3. 标识符与签名校验

`[Step 2 Complete]` 后进入步骤 3。

调用外部标识符前，必须执行签名级校验：

- TS/JS 项目优先用 `ritsu_ts_check` 和 `ritsu_ts_symbol_query`
- 兜底使用 `ritsu_exec` 做文本级存在性校验

禁止盲猜 API、组件、函数签名。

### 4. 实现与局部验证

`[Step 3 Complete]` 后进入步骤 4。

按当前模式推进实现：

- `quick`：允许一次完成并做最小验证
- `standard`：实现后执行常规验证
- `critical`：必要时分批实现，每批都要验证

若任务规模明显超出一次安全交付范围，应拆分并明确告知用户。

### 5. 质量门禁

`[Step 4 Complete]` 后进入步骤 5。

先执行契约核对，再执行 `ritsu_run_quality_gates`。

若验证失败：

- 不得带着失败宣称完成
- 原因明确则继续修复
- 原因不明确则回到 `hunt`
- 边界失真则回到 `think`

### 6. 交付回执与对账

`[Step 5 Complete]` 后进入步骤 6。

应写 `dev-report`。

若最终实现已推翻上游 `think-plan`、`delivery-plan` 或 `handoff` 的关键假设，必须先修正文档，避免设计与代码漂移。

> 引用 `_shared/skill-common-steps.md` Step 4（skill=dev）

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=dev, artifact=.ritsu/dev-report-{ts}.md；兼容旧名前缀）
