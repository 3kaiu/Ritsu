---
name: test
version: "3.8.0"
description: "Ritsu 交付验证子模块。为 deliver 和 assure 提供补测、执行验证与覆盖确认。"
when_to_use: "/r-test, 写测试, 补测试, 测试覆盖, test, 单测, 集成测试"
total_steps: 5
fast_mode:
  skip_steps: [1, 4]
  skip_artifacts: true
  self_test: "ritsu_run_quality_gates"
  description: "在 quick 交付中直接进入用例编写和执行验证"
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

# Test: Deliver / Assure 验证子模块 (Verification Module)

**触发条件**：用户输入 `/r-test`，或 `deliver / assure` 需要补测和验证时调用。

> 该模块不再是产品一线入口，而是交付和验收的验证层。

## 执行流水线

### 1. 领域解析与测试策略

> 引用 `_shared/skill-common-steps.md` Step 1

根据领域和当前交付模式确定验证重点：

- backend：单测 + 集成测试
- frontend：单测 + 组件交互测试
- fullstack：双侧验证 + 契约一致性

### 2. 测试目标识别

`[Step 1 Complete]` 后进入步骤 2。

测试目标来源优先级：

- 当前 diff
- delivery-plan / delivery-report / intake-ticket 中的目标、风险和验收要求（优先）
- handoff 实施清单（若存在，用于细化测试边界）
- release-advice（若存在，用于对齐灰度、回滚和发布验证要求）
- 用户显式指定

若已有测试存在，则优先补缺口；若无，则从零补最关键路径。

若需要检索 `.ritsu/` 历史记录，默认先查 `layers=["primary"]`；只有主链路产物不足以界定覆盖边界时，才补充 `layers=["evidence"]`。

### 3. 用例编写

`[Step 2 Complete]` 后进入步骤 3。

测试用例必须：

- 可独立运行
- 遵循 Arrange-Act-Assert
- 不依赖顺序和全局污染

同时对领域纪律和攻击向量补最必要的防御性测试。

### 4. 执行与覆盖确认

`[Step 3 Complete]` 后进入步骤 4。

调用 `ritsu_run_quality_gates` 执行验证。

必要时执行覆盖率命令：

- 达标 → 继续
- 未达标 → 优先补关键路径，而不是机械追求覆盖数字

### 5. 交付摘要

`[Step 4 Complete]` 后进入步骤 5。

> 引用 `_shared/skill-common-steps.md` Step 4（skill=test）

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=test, artifact=null）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=test）
