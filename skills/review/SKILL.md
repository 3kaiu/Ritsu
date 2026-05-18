---
name: review
version: "6.1.0"
description: "Ritsu 最终验收入口。产出《验收单 (Assurance Sheet)》，决定是否可合并、可上线。"
when_to_use: "/r-review, review, code review, 审查代码, 最终验收"
total_steps: 4
---

# Review: 自适应架构级质量验收

**触发条件**：用户输入 `/r-review`。

## 执行流水线

### 0. 分级判定

> 引用 `_shared/skill-common-steps.md` Step 0

判定完成后，按等级分叉：

---

### 🟢 Micro 路径 (P0)

**准入条件**: 极小变更，已通过自测。

1. **快速审查**: 对照变更 Diff，确认无低级错误。
2. **结论**: 直接输出 "验收通过"。无需产出 `assurance-sheet`。

---

### 🟡 Standard 路径 (P1)

1. **证据链对账**: 关联最新的 `design-brief` 或 `dev-report`。
2. **质量审计**: 检查代码一致性，对照 `anti-patterns.yaml` 进行红线扫描。
3. **偏好学习 (Preference Learning)**: 若存在明显的样式或库选用倾向，调用 `ritsu_write_preference` 记录。
4. **验收结论**: 给出 PASS/FAIL 结论。

---

### 🔴 Critical 路径 (P2)

1. **三方证据对账 (Triple Verification)**:
   - 调用 `ritsu_join_trace` 获取 Span Tree。
   - 必须建立三方关联：`design.contracts` (契约) ↔ `dev.gates` (门禁结果) ↔ `assurance.verdict` (验收判定)。
   - 验证 `dev-report` 中的覆盖率是否填补了 `design-sheet` 中的 contracts 缺口。
2. **深度架构审计**: 
   - 提取专项优化与攻击向量规则。
   - 反模式拦截：若发现违规，必须调用 `ritsu_emit_event(status: violation_detected)` 记录 `rule_id` 与 `evidence`。
   - 架构一致性验证。
3. **验收单 (Assurance Sheet) 产出**: 包含结论、风险矩阵、发布建议。
4. **偏好深度学习**: 从验收结论中提取架构级、命名级偏好，调用 `ritsu_write_preference` 更新自适应记忆。
5. **归档**: 调用 `ritsu_close_span(status: done/failed)` 结束追踪。
