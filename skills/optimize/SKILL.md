---
name: optimize
version: "3.8.0"
description: "Ritsu 专项模式。用于减法优化与等价替换，不作为主入口。"
when_to_use: "/r-opt, 优化, 精简, 性能优化, 代码瘦身, 提速"
total_steps: 5
fast_mode:
  skip_steps: [4]
  skip_artifacts: true
  self_test: "ritsu_run_quality_gates"
  description: "直接执行确认过的优化项并做验证"
hard_constraints:
  - id: HC-1
    rule: "优化前后功能必须完全等价"
    severity: FATAL
  - id: HC-2
    rule: "禁止新增功能、样式、布局、结构"
    severity: FATAL
  - id: HC-3
    rule: "每项优化必须可独立验证"
    severity: FATAL
---

# Optimize: 专项优化模式

**触发条件**：用户输入 `/r-opt`，或 `dev` 需要对已确认范围执行减法优化时调用。

它不是一线产品入口，而是围绕 `dev` 的专项动作。
若 runtime 可用，应复用当前 `dev` 上下文与 flow state，而不是另起一条与主交付链路脱节的执行记录。
