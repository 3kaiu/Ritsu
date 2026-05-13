---
name: triage
version: "4.1.0"
description: "Ritsu 辅助入口。用于处理 Issue / PR 工单的分类、裁决和流转，不做业务实现。"
when_to_use: "/r-triage, 处理 issue, 看一下 PR, 批量回复, 工单"
total_steps: 4
fast_mode:
  skip_steps: [3]
  skip_artifacts: true
  self_test: null
  description: "保持轻量，快速完成工单分类和下一步指向"
hard_constraints:
  - id: HC-1
    rule: "不得把工单处理伪装成业务实现"
    severity: FATAL
---

# Triage: 领域感知型工单流转
19: 
20: **触发条件**：用户输入 `/r-triage`，或指明需要处理 Issue / PR 工单。
21: 
22: ## 执行流水线
23: 
24: ### 1. 工单解析与领域识别 (Domain Identification)
25: 
26: 识别工单的核心技术特征：
27: - **技术领域分类**：识别该工单涉及的技术栈领域（前端/后端/基建/数据/全栈）。
28: - **影响评估**：初步判断该变更对现有系统架构的影响程度（Breaking change / Minor fix）。
29: 
30: ### 2. 智能决策与流转 (Smart Routing)
31: 
32: 将外部工单映射至 Ritsu 交付流水线的最佳切入点：
33: - **Feature / Refactor** -> 流转至 `think`（开启架构评审，自动匹配对应领域的专家人格）。
34: - **Bug / Hotfix** -> 流转至 `hunt`（开启故障取证）或 `dev`（直接修复）。
35: - **PR Review** -> 流转至 `review`（进入技术栈专项验收）。
36: 
37: ### 3. 交付总结与下一步引导
38: 
39: > 引用 `_shared/skill-common-steps.md` Step 4（skill=triage）
40: 
41: **引导建议**：
42: - 明确告知分类结论及建议的下一步 `/r-` 指令。
43: - **示例**：“该 Issue 已识别为【后端-并发瓶颈】领域。建议运行 `/r-hunt` 开始根因取证。”
44: 
45: ## 核心纪律
46: - **严禁越位**：Triage 仅负责分类与流转决策，严禁在该阶段进行任何业务代码实现。
