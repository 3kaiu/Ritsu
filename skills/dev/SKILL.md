---
name: dev
version: "4.0.0"
description: "Ritsu 开发实现入口。根据已确认的《设计单 (Design Sheet)》完成代码实现与验证。"
when_to_use: "/r-dev, 写代码, 开发, 修复 bug, 开始实现"
total_steps: 5
---

# Dev: 代码实现与交付

**触发条件**：用户输入 `/r-dev`。

## 执行流水线

### 1. 目标对账与上下文加载

> 引用 `_shared/skill-common-steps.md` Step 0

自动关联最新的 **`design-sheet`**：
- 确认交付目标、范围和精准的实施清单。
- 设计单必须包含足够的实施细节（契约、改动点），使得开发过程无需额外调研。
- 如果没有设计产物，提示风险并告知用户：“未发现前序设计单，我将基于当前对话进行实现，但这可能增加返工风险。”

### 2. 编码实现 (Implementation)

严格服从 `design-sheet` 中的实施清单：
- **HC-1**: 引用标识符前必须校验存在性。
- **HC-2**: 禁止占位符。
- **HC-3**: 不得擅自扩大范围。

### 3. 质量门禁 (Quality Gates)

在交付前执行验证：
- 运行 `ritsu_run_quality_gates`。
- 如果失败，优先在 `dev` 阶段解决；若原因不明，建议转入 `hunt`。

### 4. 交付回执 (Dev Report)

产出 **`dev-report`**：
- 记录实施结果、主要变更和验证状态。
- 如果实现过程中调整了设计假设，应提示用户并在 `dev-report` 中记录漂移。

### 5. 摘要与建议

> 引用 `_shared/skill-common-steps.md` Step 4（skill=dev）

**强制引导语**：
- 在输出摘要后，明确告知用户开发已完成。
- **示例**：“代码已实现并完成质量自测。建议运行 `/r-review` 进行最终验收。”
