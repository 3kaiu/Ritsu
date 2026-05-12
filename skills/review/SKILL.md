---
name: review
version: "3.8.0"
description: "Ritsu 主入口。基于代码、验证结果和风险状态给出最终验收结论。"
when_to_use: "/r-review, review, code review, 审查代码, 最终验收, 看看能不能合并"
total_steps: 5
fast_mode:
  skip_steps: [4]
  skip_artifacts: false
  self_test: null
  description: "跳过深度风险扩展，优先产出快速验收结论"
hard_constraints:
  - id: HC-1
    rule: "阻断项命中后必须给出不可合并/不可上线结论，禁止继续包装成可接受风险"
    severity: FATAL
  - id: HC-2
    rule: "无论 PASS/FAIL，必须写入验收结论产物"
    severity: FATAL
  - id: HC-3
    rule: "变更获取必须同时使用工作区和暂存区两个命令"
    severity: FATAL
  - id: HC-4
    rule: "验收结论必须同时覆盖阻断项、剩余风险和建议动作"
    severity: FATAL
---

# Review: 最终验收入口

**触发条件**：用户输入 `/r-review`。

## 执行流水线

> 若 runtime 可用，先用 `ritsu_run_flow(flow_id="review-acceptance")` 建立执行骨架；AI 主要处理阻断判断、验收结论和发布姿态，并在判断位结束后用 `ritsu_apply_flow_decision` 回写。

### 1. 领域解析

> 引用 `_shared/skill-common-steps.md` Step 1

### 2. 交付证据收集

`[Step 1 Complete]` 后进入步骤 2。

调用 **`ritsu_get_diff`** 获取结构化变更分析。

同时收集本次交付的核心证据：

- 变更内容
- `think-ticket / think-plan / dev-report / review-report / review-advice`（兼容旧名 `intake-ticket / delivery-plan / delivery-report / assurance-report / release-advice` 同样可读）
- `handoff / diagnosis`
- 质量门禁结果
- 契约覆盖情况
- 是否存在高风险变更

### 3. 阻断项检查

`[Step 2 Complete]` 后进入步骤 3。

按优先级检查 `_shared/anti-patterns.yaml` review 红线。

一旦命中阻断项，必须立即给出：

- 不可合并 / 不可上线
- 阻断原因
- 建议回退路径

### 4. 风险与建议评估

`[Step 3 Complete]` 后进入步骤 4。

按当前领域已加载的 `attack_vectors` 逐条审查。

同时必须额外输出：

- 至少 3 条潜在风险（触发条件 + 影响 + 如何验证）
- 至少 2 条改进建议

### 5. 写入验收结论

`[Step 4 Complete]` 后进入步骤 5。

优先写 `review-report`。

当本次验收需要给出明确发布姿态时，额外写 `review-advice`。

若结果为 FAIL，必须明确建议回到：

- `dev`
- `test`
- `hunt`
- `think`

之一，而不是只给模糊结论。

> 引用 `_shared/skill-common-steps.md` Step 4（skill=review）

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=review, artifact=.ritsu/review-report-{ts}.md；兼容旧名前缀）
