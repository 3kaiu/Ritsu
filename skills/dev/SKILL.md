---
name: dev
version: "4.1.0"
description: "Ritsu 开发实现入口。根据已确认的《设计单 (Design Sheet)》完成代码实现与验证。"
when_to_use: "/r-dev, 写代码, 开发, 修复 bug, 开始实现"
total_steps: 5
---

# Dev: 高保真代码实现与交付
11: 
12: **触发条件**：用户输入 `/r-dev`。
13: 
14: ## 执行流水线
15: 
16: ### 1. 目标对账与技术栈感知 (Stack Perception)
17: 
18: > 引用 `_shared/skill-common-steps.md` Step 0
19: 
20: 自动关联最新的 **`design-sheet`**：
21: - **技术栈感知**：识别项目指纹，自动切换至对应的资深专家人格（Persona）。
22: - **纪律对齐**：根据技术栈加载对应的 `coding_disciplines` 和 `optimize_disciplines`。
23: - 确认交付目标、范围和精准的实施清单。
24: 
25: ### 2. 地道化编码实现 (Idiomatic Implementation)
26: 
27: 严格服从 `design-sheet` 并执行领域纪律：
28: - **高保真实现**：代码风格、工具库选择、异步模式必须与领域 YAML 定义 100% 对齐。
29: - **HC-1 (引用安全)**：所有引用标识符前必须通过 grep/semantic 校验存在性。
30: - **HC-2 (零占位符)**：严禁使用 `// TODO`、`...` 或任何逻辑占位符。
31: - **HC-3 (范围控制)**：严禁擅自修改 `design-sheet` 之外的代码或扩大实施范围。
32: 
33: ### 3. 质量门禁 (Quality Gates)
34: 
35: 在交付前执行验证：
36: - 运行 `ritsu_run_quality_gates` 或对应的本地构建/Lint 命令。
37: - 如果失败，优先在 `dev` 阶段解决；若原因不明，建议转入 `hunt`。
38: 
39: ### 4. 交付回执 (Dev Report)
40: 
41: 产出 **`dev-report`**：
42: - 记录实施结果、主要变更。
43: - **纪律合规确认**：显式确认是否遵守了对应的技术栈专项纪律（如：已完成 Tailwind 迁移、已包裹事务）。

### 5. 摘要与建议

> 引用 `_shared/skill-common-steps.md` Step 4（skill=dev）

**强制引导语**：
- 在输出摘要后，明确告知用户开发已完成。
- **示例**：“代码已实现并完成质量自测。建议运行 `/r-review` 进行最终验收。”
