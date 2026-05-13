---
name: hunt
version: "4.1.0"
description: "Ritsu 技术诊断入口。通过取证与假设验证锁定根因，并给出修复建议。"
when_to_use: "/r-hunt, 报错了, 排障, 诊断, debug, 找不到问题在哪"
total_steps: 4
---

# Hunt: 架构级技术诊断与排障
11: 
12: **触发条件**：用户输入 `/r-hunt`。
13: 
14: ## 执行流水线
15: 
16: ### 1. 深度取证与技术栈感知 (Stack Perception)
17: 
18: > 引用 `_shared/skill-common-steps.md` Step 0
19: 
20: 自动关联：
21: - 报错现场 (Logs/Stacktrace/Error message)
22: - **技术栈感知**：识别故障发生的组件技术栈，自动切换至对应的资深专家人格（Persona）。
23: - 关联证据：`dev-report` (变更历史) 与 `design-sheet` (原始方案)。
24: 
25: ### 2. 定向假设与 MECE 验证 (Targeted Hypothesizing)
26: 
27: **假设生成准则**：
28: - **参考领域知识**：优先对照 `frontend.yaml`, `backend.yaml`, `infra.yaml` 等配置中的 **`hypothesis_directions`**（如：React Stale Closure, Go Deadlock, K8s DNS Failure）。
29: - **MECE 原则**：提出 1-3 个相互独立、完全穷尽的科学假设。
30: - **验证设计**：为每个假设设计基于特定工具（如：`pprof`, `Chrome DevTools`, `kubectl logs`）的验证动作。
31: 
32: ### 3. 诊断结论 (Diagnosis) 与修复建议
33: 
34: 锁定根因并产出诊断报告：
35: - 如果问题复杂，建议产出 **`diagnosis`** 产物记录证据链。
36: - 修复建议必须符合领域最佳实践（例如：修复 React 竞态应建议使用 AbortController 或状态锁定）。
37: 
38: ### 4. 交付摘要与引导
39: 
40: > 引用 `_shared/skill-common-steps.md` Step 4（skill=hunt）
41: 
42: **引导建议**：
43: - 确诊后，引导用户进入 `/r-dev` 进行修复，或进入 `/r-think` 针对架构缺陷重设方案。
