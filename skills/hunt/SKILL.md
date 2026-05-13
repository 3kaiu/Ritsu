---
name: hunt
version: "4.1.0"
description: "Ritsu 技术诊断入口。通过取证与假设验证锁定根因，并给出修复建议。"
when_to_use: "/r-hunt, 报错了, 排障, 诊断, debug, 找不到问题在哪"
total_steps: 4
---

# Hunt: 故障排除与诊断

**触发条件**：用户输入 `/r-hunt`。

## 执行流水线

### 1. 现状取证与症状归纳

> 引用 `_shared/skill-common-steps.md` Step 0

自动关联：
- 报错信息 (Logs/Stacktrace)
- **`dev-report`** (最近的改动)
- **`design-sheet`** (原始预期)

### 2. 根因假设与排除

提出 1-3 个可验证假设：
- **假设**：是什么坏了？
- **验证**：如何证明这个假设成立？
- **排除**：如果什么现象没出现，则排除该假设。

### 3. 诊断结论 (Diagnosis)

锁定根因并产出诊断结论：
- 如果问题复杂，建议产出 **`diagnosis`** 产物记录证据链。
- 给出明确的修复动作建议。

### 4. 交付摘要与引导

> 引用 `_shared/skill-common-steps.md` Step 4（skill=hunt）

**引导建议**：
- 确诊后，根据问题性质建议回到 `/r-dev` (修复) 或 `/r-think` (重设方案)。
