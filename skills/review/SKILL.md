---
name: review
version: "4.1.0"
description: "Ritsu 最终验收入口。产出《验收单 (Assurance Sheet)》，决定是否可合并、可上线。"
when_to_use: "/r-review, review, code review, 审查代码, 最终验收"
total_steps: 4
---

# Review: 最终交付验收

**触发条件**：用户输入 `/r-review`。

## 执行流水线

### 1. 证据链对账

> 引用 `_shared/skill-common-steps.md` Step 0

自动关联：
- 代码变更 (Diff)
- 关联的 **`design-sheet`**（原始设计）
- **`dev-report`**（开发回执）
- 质量门禁执行结果

### 2. 阻断项与红线检查

对照 `_shared/anti-patterns.yaml` 检查红线：
- 如果命中阻断项，给出 **FAIL** 结论。
- 即使通过，也要识别潜在的“剩余风险”。

### 3. 验收单 (Assurance Sheet) 产出

产出 **`assurance-sheet`**：
- 包含：合并/上线结论、阻断项与风险、发布建议（灰度/放量/业务影响）。
- 旨在为项目管理层或业务方提供决策依据。

### 4. 交付总结与建议

> 引用 `_shared/skill-common-steps.md` Step 4（skill=review）

**引导建议**：
- 如果 PASS，告知发布流程。
- 如果 FAIL，明确告知应回到哪个阶段（Think/Dev/Hunt）修复。
- **示例**：“验收已通过，`assurance-sheet` 已生成。建议执行发布流程或运行 `/r-deploy`。”
