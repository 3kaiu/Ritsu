---
name: refactor
version: "3.8.0"
description: "Ritsu 交付模式能力。用于 deliver 内的结构改善任务，保持行为不变，不再视为主产品入口。"
when_to_use: "/r-refactor, 重构, 提取模块, 重命名, 拆分, 合并, 改结构"
total_steps: 5
fast_mode:
  skip_steps: [1]
  skip_artifacts: true
  self_test: "ritsu_run_quality_gates"
  description: "在目标明确时直接进入重构与验证"
hard_constraints:
  - id: HC-1
    rule: "重构前必须确认测试基线存在且通过"
    severity: FATAL
  - id: HC-2
    rule: "重构后原有行为必须保持不变"
    severity: FATAL
  - id: HC-3
    rule: "范围不得超出用户指定目标"
    severity: FATAL
---

# Refactor: Deliver 模式能力 (Refactor Mode)

**触发条件**：用户输入 `/r-refactor`，或 `deliver` 以 refactor 模式处理结构改善任务时调用。

> 该模块现在属于 `deliver` 的模式能力，而不是产品一线入口。

## 执行流水线

### 1. 领域解析与目标确认

> 引用 `_shared/skill-common-steps.md` Step 1

明确本次重构目标：

- 提取
- 重命名
- 移动
- 合并

一次只做一种结构动作。

### 2. 影响分析与测试基线

`[Step 1 Complete]` 后进入步骤 2。

必要时执行影响分析，确认哪些调用点会受影响。

随后执行 `ritsu_run_quality_gates`：

- 测试通过 → 继续
- 测试失败或无测试 → 停止本次重构

### 3. 重构执行

`[Step 2 Complete]` 后进入步骤 3。

按目标类型执行结构调整，并持续检查：

- 引用点是否完整更新
- 接口签名是否保持稳定
- 行为是否未变

### 4. 回归验证

`[Step 3 Complete]` 后进入步骤 4。

执行完整验证：

- 全部通过 → 继续
- 有失败 → 回滚本次重构并说明原因

### 5. 交付摘要

`[Step 4 Complete]` 后进入步骤 5。

> 引用 `_shared/skill-common-steps.md` Step 4（skill=refactor）

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=refactor, artifact=null）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=refactor）
