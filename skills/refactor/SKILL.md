---
name: refactor
version: "3.8.0"
description: "Ritsu 专项模式。用于保持行为不变的结构改善，不作为主入口。"
when_to_use: "/r-refactor, 重构, 提取模块, 重命名, 拆分, 合并, 改结构"
total_steps: 5
fast_mode:
  skip_steps: [4]
  skip_artifacts: true
  self_test: "ritsu_run_quality_gates"
  description: "在目标明确时直接进入重构与验证"
hard_constraints:
  - id: HC-1
    rule: "重构前后功能必须保持等价"
    severity: FATAL
  - id: HC-2
    rule: "禁止借重构名义偷偷加功能"
    severity: FATAL
  - id: HC-3
    rule: "每项结构调整必须可独立验证"
    severity: FATAL
---

# Refactor: 专项重构模式

**触发条件**：用户输入 `/r-refactor`，或 `dev` 已确认本轮只做结构改善时调用。

它不是一线产品入口，而是围绕 `dev` 的专项动作。
若 runtime 可用，应复用当前 `dev` 上下文与 flow state，而不是另起一条与主交付链路脱节的执行记录。
