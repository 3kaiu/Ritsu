---
name: triage
version: "4.1.0"
description: "Ritsu 辅助入口。用于处理 Issue / PR 工单的分类、裁决和流转，不做业务实现。"
when_to_use: "/r-triage, 处理 issue, 看一下 PR, 批量回复, 工单"
total_steps: 4
fast_mode:
  skip_steps: [3]
  skip_artifacts: true
  self_test: null
  description: "保持轻量，快速完成工单分类和下一步指向"
hard_constraints:
  - id: HC-1
    rule: "不得把工单处理伪装成业务实现"
    severity: FATAL
---

# Triage: 工单流转入口

**触发条件**：用户输入 `/r-triage`，或指明需要处理 Issue / PR 工单。

> 该模块负责把外部工单映射回默认交付链路，而不是自己变成实现或验收入口。

典型流转：

- Feature -> 进入 `think`
- Fix ready -> 进入 `dev`
- 验收争议 -> 进入 `review`
