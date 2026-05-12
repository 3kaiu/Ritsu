---
name: dev
version: "3.8.0"
description: "Ritsu 交付执行子模块。根据 deliver 模式完成实现、验证和必要的文档对账，是核心落地引擎。"
when_to_use: "/r-dev, 写代码, 开发, 修复 bug"
total_steps: 6
fast_mode:
  skip_steps: [2, 5]
  skip_artifacts: true
  self_test: "ritsu_run_quality_gates"
  description: "在 quick 交付中降低交互密度，保留实现与基本验证"
hotfix_mode:
  description: "兼容历史 hotfix；现在可视为 quick 模式下的极小改动子集"
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
    rule: "实现必须服从当前 deliver 模式的边界，不得擅自扩大范围"
    severity: FATAL
---

# Dev: Deliver 核心执行子模块 (Core Delivery Engine)

**触发条件**：用户输入 `/r-dev`，或 `deliver` 内部进入实现阶段时调用。

> 该模块现在是 `deliver` 的核心落地引擎，而不是独立产品入口。

## 执行流水线

### 1. 领域解析与目标绑定

> 引用 `_shared/skill-common-steps.md` Step 1

优先绑定当前交付目标：

- delivery-plan / delivery-report / intake-ticket（优先）
- handoff（若存在，用于实施细化）
- diagnosis（若为 bugfix）
- intake 执行单中的当前目标

若无明确设计产物，可继续执行，但必须在交付摘要中标注“无上游设计溯源”。

若需要检索 `.ritsu/` 历史记录，默认先查 `layers=["primary"]`；只有主链路产物不足以解释当前实现边界或历史决策时，才补充 `layers=["evidence"]`。

### 2. 编码边界与规则加载

`[Step 1 Complete]` 后进入步骤 2。

读取项目级规则覆盖和领域纪律，将其作为本次实现约束。

`quick` 模式：

- 优先直接实现
- 保持改动集中

`standard / critical` 模式：

- 更严格服从主链路产物的目标、风险和验收结论
- 若存在 `delivery-plan`，优先按其范围、步骤、验证计划推进
- 若存在 handoff，再将其作为实施细化约束

### 3. 标识符与签名校验

`[Step 2 Complete]` 后进入步骤 3。

调用外部标识符前，必须执行签名级校验：

- TS/JS 项目优先用 `ritsu_ts_check` 和 `ritsu_ts_symbol_query`
- 兜底使用 `ritsu_exec` 做文本级存在性校验

禁止盲猜 API、组件、函数签名。

### 4. 实现与局部验证

`[Step 3 Complete]` 后进入步骤 4。

按当前交付模式推进实现：

- `quick`：允许一次完成并做最小验证
- `standard`：实现后执行常规验证
- `critical`：必要时分批实现，每批都要验证

当任务规模明显超出一次安全交付范围时，才进行分块，不再默认把所有复杂任务强制切碎成交互式流程。

### 5. 质量门禁

`[Step 4 Complete]` 后进入步骤 5。

先执行契约核对，再执行 `ritsu_run_quality_gates`。

若验证失败：

- 不得带着失败宣称完成
- 必须继续修复，或回到 `hunt / think`

当出现环境不一致、不可稳定复现等情况时，可触发诊断路径，但诊断是为恢复交付，不是为了展示高级能力。

### 6. 文档对账与交付摘要

`[Step 5 Complete]` 后进入步骤 6。

若最终实现已推翻上游 `delivery-plan` 的目标范围、验证计划或回滚假设，必须先修正 `delivery-plan`。

若最终实现已推翻上游 handoff 的关键契约，必须修正 handoff，避免设计与代码漂移。

若本次仅基于 `intake-ticket` 直接交付完成，应在 `delivery-report` 中明确标注“未生成 delivery-plan/handoff，按轻量契约执行”。

> 引用 `_shared/skill-common-steps.md` Step 4（skill=dev）

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=dev, artifact=null）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=dev）
