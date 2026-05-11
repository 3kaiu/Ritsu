---
name: read
version: "3.8.0"
description: "Ritsu 代码阅读与解释技能。阅读代码、解释逻辑、回答技术问题。只读不写，绝对禁止修改任何文件。"
when_to_use: "/r-read, 看看这个, 解释一下, 这段代码什么意思, 帮我读一下, 理解一下, 分析一下代码"
total_steps: 3
fast_mode:
  skip_steps: [1, 3]
  skip_artifacts: true
  self_test: null
  description: "跳过领域解析(1)和摘要输出(3)，直接阅读+解释，不写产物文件"
hard_constraints:
  - id: HC-1
    rule: "绝对禁止修改任何文件（代码/配置/文档），只允许读取和解释"
    severity: FATAL
  - id: HC-2
    rule: "ref AP-2: 引用代码中的标识符时，必须确保其在上下文中真实存在，禁止臆测"
    severity: FATAL
  - id: HC-3
    rule: "不得主动建议重构或优化方案（那是 /r-think 或 /r-opt 的职责），只回答用户的问题"
    severity: WARN
---

# Read: 代码阅读与解释 (Code Reading & Explanation)

**触发条件**：用户输入 `/r-read`，或表达"看看/解释/理解/读一下"等纯阅读意图。

## 执行流水线

### 1. 领域解析 + 目标定位

> 引用 `_shared/skill-common-steps.md` Step 1

`[Step 1 Complete]` 后确定阅读目标：

- **用户指定文件/函数/模块** → 直接定位
- **用户指定 IDE 焦点文件** → 零点击绑定，直接读取
- **用户描述问题但未指定文件** → 调用 `ritsu_get_changed_files` + `ritsu_exec` (grep) 定位相关文件

### 2. 代码阅读与结构化解释

`[Step 1 Complete]` 后进入步骤 2。

按用户需求深度分层输出：

| 深度     | 触发条件                    | 输出格式                                    |
| -------- | --------------------------- | ------------------------------------------- |
| **概览** | "大概看看"/"整体结构"       | 模块职责 + 公开接口列表 + 依赖关系          |
| **逻辑** | "解释一下"/"什么意思"       | 逐段逻辑解读 + 数据流向 + 关键决策点        |
| **细节** | "具体怎么工作的"/"深入分析" | 逐行/逐函数解读 + 调用链追踪 + 边界条件分析 |

**阅读纪律**：

- 引用外部标识符前，必须通过 `ritsu_exec` (grep) 验证其存在（HC-2）
- 不确定的推断必须标注 `⚠️ 推测`，不得伪装为确定结论
- 涉及多个文件时，按调用链顺序组织，避免碎片化输出

### 3. 输出问答摘要

`[Step 2 Complete]` 后进入步骤 3。

输出结构化摘要：

```
## 📖 阅读摘要
- 目标: {文件/模块}
- 深度: {概览/逻辑/细节}
- 核心发现: {1-3 条关键结论}
- 未解答: {如有，列出需进一步调查的问题}
```

写入 ctx（started + done 事件）：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=read, artifact=null）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=read）

常见后续：用户基于阅读结果决定行动 → `/r-think`（设计方案）/ `/r-dev`（直接开发）/ `/r-hunt`（排查问题）/ `/r-opt`（优化）
