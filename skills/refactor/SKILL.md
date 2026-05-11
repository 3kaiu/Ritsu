---
name: refactor
version: "3.8.0"
description: "Ritsu 结构重构技能。提取模块、重命名、调整架构层级。改变结构但不改变行为，必须有测试保障。"
when_to_use: "/r-refactor, 重构, 提取模块, 重命名, 拆分, 合并, 改结构"
total_steps: 5
fast_mode:
  skip_steps: [1]
  skip_artifacts: true
  self_test: "ritsu_run_quality_gates"
  description: "跳过重构目标建议(1)，直接执行用户指定的重构+质量门禁自测，不写产物文件"
hard_constraints:
  - id: HC-1
    rule: "重构前必须确认测试基线存在且通过，无测试保障的重构禁止执行"
    severity: FATAL
  - id: HC-2
    rule: "重构后所有原有测试必须仍然通过（行为不变），新增测试覆盖重构引入的接口"
    severity: FATAL
  - id: HC-3
    rule: "ref AP-4: 重构范围不得超出用户指定的模块/文件，禁止顺手优化无关代码"
    severity: FATAL
  - id: HC-4
    rule: "每次重构只做一种结构变更（提取/重命名/移动/合并），禁止混合多种重构"
    severity: WARN
---

# Refactor: 结构重构 (Structural Refactoring)

**触发条件**：用户输入 `/r-refactor`，或表达"重构/提取/重命名/拆分/合并/改结构"等意图。

> ⚠️ **与 optimize 的区别**：optimize 只做减法和等价替换（删除死代码、合并冗余逻辑），不改变代码结构。refactor 允许改变结构（提取模块、重命名、移动文件），但行为必须不变。

> ⚠️ **与 dev 的区别**：dev 由 Handoff 实施清单驱动，面向新功能/修复。refactor 面向已有代码的结构改善，不新增功能。

## 执行流水线

### 1. 领域解析 + 重构目标确认

> 引用 `_shared/skill-common-steps.md` Step 1

在确认重构目标后，必须执行一次全局影响分析（Impact Analysis），防止“顾头不顾腚”：

- 调用 `ritsu_build_kg` 构建/刷新 `.ritsu/kg.json`
- 若用户给的是文件级目标（如“重命名 src/a.ts”）：调用 `ritsu_query_kg({mode:"impact", target:"src/a.ts", depth:3})`
- 若用户给的是符号级目标（如“重命名 class Foo”）：调用 `ritsu_query_kg({mode:"symbol", symbol:"Foo", depth:3})`

输出格式：

```
## 🔎 Impact Analysis
- 目标: {file/symbol}
- 反向影响(Top N):
  - {file1}
  - {file2}
- 风险: {为什么会挂}
- 验证策略: {要跑哪些测试/怎么 spot-check}
```

`[Step 1 Complete]` 后确认重构目标：

- **用户指定重构类型** → 直接执行
- **用户只说"重构"** → 分析代码结构，提出 1-2 个最高价值的重构建议，等待用户选择

### 2. 测试基线确认（HC-1 执行）

`[Step 1 Complete]` 后进入步骤 2。

调用 **`ritsu_run_quality_gates`** 执行 Lint + Test：

- **测试通过** → 记录当前测试基线，继续步骤 3
- **测试失败** → 停止，告知用户"当前测试未通过，必须先修复测试再重构"，建议 `/r-hunt` 排查
- **无测试** → 停止，告知用户"无测试保障的重构风险极高"，建议先 `/r-test` 补充测试

### 3. 重构执行

`[Step 2 Complete]` 后进入步骤 3。

按重构类型执行（HC-4：每次只做一种）：

| 重构类型   | 操作                 | 验证点                         |
| ---------- | -------------------- | ------------------------------ |
| **提取**   | 提取函数/模块/组件   | 提取后的接口签名与原调用点对齐 |
| **重命名** | 变量/函数/文件重命名 | 所有引用点同步更新，无遗漏     |
| **移动**   | 文件/目录迁移        | import 路径全部修正            |
| **合并**   | 合并重复逻辑/模块    | 合并后的行为与原多处调用一致   |

**执行纪律**：

- 每完成一步重构，立即调用 `ritsu_run_quality_gates` 验证测试仍通过
- 标识符引用前必须通过 `ritsu_exec` (grep) 验证（≈AP-2）
- 重命名时必须使用 `ritsu_get_diff` 确认所有引用点已更新

### 4. 测试回归验证（HC-2 执行）

`[Step 3 Complete]` 后进入步骤 4。

调用 **`ritsu_run_quality_gates`** 执行完整 Lint + Test：

- **全部通过** → 继续步骤 5
- **有失败** → 回滚本次重构（`git checkout -- .`），告知用户失败原因，等待指示

### 5. 交付摘要

`[Step 4 Complete]` 后进入步骤 5。

> 引用 `_shared/skill-common-steps.md` Step 4（skill=refactor）

写入 ctx（started + done 事件）：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=refactor, artifact=null）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=refactor）

常见后续：`/r-review`（审查重构质量）/ `/r-test`（补充新接口测试）/ `/r-opt`（重构后精简）
