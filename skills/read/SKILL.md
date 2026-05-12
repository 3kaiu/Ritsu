---
name: read
version: "3.8.0"
description: "Ritsu intake 支撑模块。用于阅读代码、补上下文、回答纯理解类问题，只读不写。"
when_to_use: "/r-read, 看看这个, 解释一下, 这段代码什么意思, 帮我读一下, 理解一下, 分析一下代码"
total_steps: 3
fast_mode:
  skip_steps: [1, 3]
  skip_artifacts: true
  self_test: null
  description: "直接阅读并输出关键结论"
hard_constraints:
  - id: HC-1
    rule: "绝对禁止修改任何文件，只允许读取和解释"
    severity: FATAL
  - id: HC-2
    rule: "引用代码中的标识符时，必须确保其在上下文中真实存在"
    severity: FATAL
  - id: HC-3
    rule: "若用户只要求理解，不得强行推销重构或优化方案"
    severity: WARN
---

# Read: Intake 支撑模块 (Context Reading Module)

**触发条件**：用户输入 `/r-read`，或 `intake` 需要补代码上下文时调用。

> 该模块主要服务于理解和上下文补全，不属于主交付动作。

## 执行流水线

### 1. 领域解析 + 目标定位

> 引用 `_shared/skill-common-steps.md` Step 1

优先定位阅读目标：

- 用户指定文件 / 函数 / 模块
- IDE 焦点文件
- 根据问题描述反查相关文件

若为了理解当前问题必须补看历史产物，默认先查主链路产物（`layers=["primary"]`）；仅当主链路信息不足时，才补充 `layers=["evidence"]` 或兼容镜像。

若问题涉及“为什么这样实现”或“为什么这样发布”，应优先检查：

- `delivery-plan`
- `delivery-report`
- `assurance-report`
- `release-advice`

### 2. 代码阅读与解释

`[Step 1 Complete]` 后进入步骤 2。

按需要输出不同深度：

- 概览：模块职责与依赖
- 逻辑：关键流程与数据流
- 细节：逐函数或逐段解释

规则：

- 外部标识符必须真实存在
- 不确定内容必须标注推测
- 多文件场景按调用链组织输出

### 3. 输出阅读摘要

`[Step 2 Complete]` 后进入步骤 3。

```markdown
## 📖 阅读摘要
- 目标: {文件/模块}
- 深度: {概览/逻辑/细节}
- 核心发现: {1-3 条关键结论}
- 未解答: {若无则写“无”}
```

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=read, artifact=null）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=read）
