---
name: test
version: "3.8.0"
description: "Ritsu 主入口。用于补测、执行验证、确认覆盖与质量门禁。"
when_to_use: "/r-test, 写测试, 补测试, 测试覆盖, 单测, 集成测试, 验证一下"
total_steps: 5
fast_mode:
  skip_steps: [1, 4]
  skip_artifacts: true
  self_test: "ritsu_run_quality_gates"
  description: "直接进入用例编写和执行验证"
hard_constraints:
  - id: HC-1
    rule: "测试代码不得修改被测业务代码"
    severity: FATAL
  - id: HC-2
    rule: "测试用例不得包含占位符"
    severity: FATAL
  - id: HC-3
    rule: "每个测试用例必须可独立运行，不依赖执行顺序"
    severity: FATAL
---

# Test: 验证与补测入口

**触发条件**：用户输入 `/r-test`，或 `dev / review` 需要补测和验证时调用。

## 执行流水线

> 若 runtime 可用，先用 `ritsu_run_flow(flow_id="test-verify")` 建立执行骨架；质量门禁结果优先从 flow state 读取，不要重复组织同一套验证步骤。若停在判断位，完成结论后用 `ritsu_apply_flow_decision` 回写。

### 1. 领域解析与测试策略

> 引用 `_shared/skill-common-steps.md` Step 1

根据领域和当前任务确定验证重点：

- backend：单测 + 集成测试
- frontend：单测 + 组件交互测试
- fullstack：双侧验证 + 契约一致性

### 2. 测试目标识别

`[Step 1 Complete]` 后进入步骤 2。

测试目标来源优先级：

- 当前 diff
- `think-plan / dev-report / think-ticket`（兼容旧名 `delivery-plan / delivery-report / intake-ticket` 同样可读）
- `handoff`
- `review-advice`（兼容旧名 `release-advice`）
- 用户显式指定

### 3. 用例编写

`[Step 2 Complete]` 后进入步骤 3。

测试用例必须：

- 可独立运行
- 遵循 Arrange-Act-Assert
- 不依赖顺序和全局污染

### 4. 执行与覆盖确认

`[Step 3 Complete]` 后进入步骤 4。

调用 `ritsu_run_quality_gates` 执行验证。

必要时执行覆盖率命令：

- 达标 -> 继续
- 未达标 -> 优先补关键路径，而不是机械追求覆盖数字

### 5. 验证摘要

`[Step 4 Complete]` 后进入步骤 5。

> 引用 `_shared/skill-common-steps.md` Step 4（skill=test）

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=test, artifact=null）
