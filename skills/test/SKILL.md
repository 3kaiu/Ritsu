---
name: test
version: "4.0.0"
description: "Ritsu 测试与验证入口。基于《设计单》和《开发回执》进行补测与质量校验。"
when_to_use: "/r-test, 写测试, 补测试, 质量门禁, 单测, 验证"
total_steps: 4
---

# Test: 质量验证与补测

**触发条件**：用户输入 `/r-test`。

## 执行流水线

### 1. 现状加载与目标识别

> 引用 `_shared/skill-common-steps.md` Step 0

自动关联：
- 当前代码变更 (Diff)
- **`design-sheet`** (包含验证计划)
- **`dev-report`** (包含初步验证结果)

### 2. 测试策略确定

根据任务风险等级决定：
- `quick`：执行核心路径冒烟。
- `standard/critical`：补齐边界用例，执行全量质量门禁。

### 3. 测试实施与执行

补齐缺失的测试用例：
- 运行 `ritsu_run_quality_gates`。
- 确认覆盖率是否达到设计预期。

### 4. 交付摘要与引导

> 引用 `_shared/skill-common-steps.md` Step 4（skill=test）

**引导建议**：
- 测试通过后，建议运行 `/r-review` 进行最终验收。
