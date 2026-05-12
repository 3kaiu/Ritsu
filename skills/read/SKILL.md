---
name: read
version: "3.8.0"
description: "Ritsu 辅助入口。用于阅读代码、补上下文、回答纯理解类问题，只读不写。"
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
---

# Read: 只读理解入口

**触发条件**：用户输入 `/r-read`，或主工作流需要补充代码上下文时调用。

> 该模块不创建新的 flow run。若当前已有 `.ritsu/flows/*.json`，应优先把阅读目标对齐到现有 `current_step / recovery_point`，服务正在进行的交付闭环。

## 执行流水线

### 1. 领域解析 + 目标定位

> 引用 `_shared/skill-common-steps.md` Step 1

### 2. 代码阅读与解释

按需要输出不同深度：

- 概览
- 逻辑
- 细节

### 3. 输出阅读摘要

> 引用 `_shared/skill-common-steps.md` Step 4（skill=read）
