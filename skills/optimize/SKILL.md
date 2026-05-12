---
name: optimize
version: "3.8.0"
description: "Ritsu 交付模式能力。用于 deliver 内的减法优化与等价替换，不再视为主产品入口。"
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

# Optimize: Deliver 模式能力 (Optimization Mode)

**触发条件**：用户输入 `/r-opt`，或 `deliver` 以 optimize 模式处理减法优化任务时调用。

> 该模块现在属于 `deliver` 的模式能力，而不是产品一线入口。

## 核心原则

只做减法和等价替换，不做产品面加法。

## 执行流水线

### 1. 领域解析

> 引用 `_shared/skill-common-steps.md` Step 1

### 2. 优化项识别

`[Step 1 Complete]` 后进入步骤 2。

识别候选优化项：

- 死代码
- 冗余逻辑
- 局部热点
- 注释和样式冗余

分析阶段只产出候选清单，不立即扩散改动。

若需要检索 `.ritsu/` 历史产物以确认优化边界，默认先查 `layers=["primary"]`；只有主链路产物不足以说明历史约束时，才补充 `layers=["evidence"]`。

若存在 `delivery-plan` 或 `release-advice`，优化不得破坏其中已经承诺的验证方式、回滚假设或发布约束。

### 3. 优化项确认

`[Step 2 Complete]` 后进入步骤 3。

明确本次优化范围：

- 执行哪些项
- 跳过哪些项
- 哪些项风险过高不进入本轮

### 4. 逐项执行与验证

`[Step 3 Complete]` 后进入步骤 4。

按项执行，每项完成后立即验证：

- 验证通过 → 保留
- 验证失败 → 回滚该项

### 5. 交付摘要

`[Step 4 Complete]` 后进入步骤 5。

> 引用 `_shared/skill-common-steps.md` Step 4（skill=optimize）

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=optimize, artifact=.ritsu/optimize-report-{ts}.md）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=optimize）
