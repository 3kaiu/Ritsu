---
name: review
version: "4.1.0"
description: "Ritsu 最终验收入口。产出《验收单 (Assurance Sheet)》，决定是否可合并、可上线。"
when_to_use: "/r-review, review, code review, 审查代码, 最终验收"
total_steps: 4
---

# Review: 架构级质量验收
11: 
12: **触发条件**：用户输入 `/r-review`。
13: 
14: ## 执行流水线
15: 
16: ### 1. 证据链对账与技术栈感知 (Stack Perception)
17: 
18: > 引用 `_shared/skill-common-steps.md` Step 0
19: 
20: 自动关联：
21: - 代码变更 (Diff)
22: - 关联的 **`design-sheet`**（原始设计）与 **`dev-report`**（开发回执）
23: - **技术栈感知**：识别项目指纹，自动切换至对应的资深架构师人格（Persona）。
24: 
25: ### 2. 深度架构审计与红线检查
26: 
27: **审计准则**：
28: - **多态质量门禁**：根据感知的技术栈，从 `frontend.yaml`, `backend.yaml`, `infra.yaml`, `data.yaml` 或 `fullstack.yaml` 中提取专项优化与攻击向量规则。
29: - **反模式拦截**：对照 `_shared/anti-patterns.yaml` 检查。
30: - **架构一致性**：验证变更是否背离了 `design-sheet` 中的核心架构决策。
31: 
32: ### 3. 验收单 (Assurance Sheet) 产出
33: 
34: 产出 **`assurance-sheet`**：
35: - **结论**：PASS (可合并) / FAIL (须修复)。
36: - **风险矩阵**：按技术栈细分的潜在隐患（如：React Stale Closure, Go Goroutine Leak, K8s Config Drift）。
37: - **发布建议**：灰度策略、观测指标与回滚预案。
38: 
39: ### 4. 交付总结与交付物归档
40: 
41: > 引用 `_shared/skill-common-steps.md` Step 4（skill=review）
42: 
43: **引导建议**：
44: - 如果 FAIL，明确告知应回到哪个阶段（Think/Dev/Hunt）并指出违反的领域准则。
45: - **高级架构确认**：对于全栈项目，必须确认 API 契约的端到端对齐情况。
