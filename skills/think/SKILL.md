---
name: think
version: "4.0.0"
description: "Ritsu 需求分析入口。产出全方位的《设计单 (Design Sheet)》，并引导进入开发阶段。"
when_to_use: "/r-think, 需求审核, 方案判断, 怎么做, 看看这个需求"
total_steps: 4
---

# Think: 需求分析与设计单产出

**触发条件**：用户输入 `/r-think`。

## 执行流水线

### 1. 现状加载与对账

> 引用 `_shared/skill-common-steps.md` Step 0

读取上下文，重点检查：
- 是否有未完成的任务
- 最近的交付记录（如果是回流任务）

### 2. 深度需求审核

分析目标、边界与风险：
- **目标**：这次到底要做成什么样？
- **边界**：明确什么是不做的。
- **风险**：识别架构侵入度或潜在的技术债。

### 3. 设计单 (Design Sheet) 产出

将分析结果落盘为 **`design-sheet`**：
- 包含：任务识别、方案范围、核心契约（API/组件）、实施清单、验证计划。
- **禁止碎片化**：除非任务极其复杂，否则禁止额外写 `handoff`。

### 4. 交付摘要与引导

> 引用 `_shared/skill-common-steps.md` Step 4（skill=think）

**强制引导语**：
- 在输出摘要后，明确告知用户设计已完成。
- **示例**：“设计单 `design-sheet-xxx.md` 已就绪。如果你满意，请运行 `/r-dev` 开始实现。”
