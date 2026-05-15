---
name: freestyle
version: "5.0.0"
description: "Ritsu 默认响应模式。处理不需要进入流程的快速交互。"
when_to_use: "/r-freestyle, 快速问答, 解释概念, 格式化代码, 计算, 翻译, 随便聊聊, 读代码, 解释逻辑, 调研"
total_steps: 1
hard_constraints:
  - id: HC-1
    rule: "若判断用户意图实际需要 think/dev/hunt/review，必须主动建议切换"
    severity: WARN
---

# Freestyle: 零流程直接响应

**触发条件**: 用户输入不匹配任何 `/r-` 指令，且不需要进入交付流程。

## 行为准则

1. **直接回答**: 不调用任何 ctx/event 工具，不产出任何产物。
2. **智能升级**: 如果回答过程中发现问题需要修改代码，主动建议 "这可能需要 `/r-dev` 来修复"。
3. **保持上下文感知**: 虽然不进入流程，但仍然感知当前项目的技术栈和领域。
