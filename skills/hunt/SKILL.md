---
name: hunt
version: "5.2.0"
description: "Ritsu 技术诊断入口。通过取证与假设验证锁定根因，并给出修复建议。"
when_to_use: "/r-hunt, 报错了, 排障, 诊断, debug, 找不到问题在哪"
total_steps: 4
---

# Hunt: 自适应技术诊断与排障

**触发条件**：用户输入 `/r-hunt`。

## 执行流水线

### 0. 分级判定

> 引用 `_shared/skill-common-steps.md` Step 0

---

### 🟡 Standard 路径 (P1) - 默认路径

1. **快速取证**: 关联报错日志或堆栈。
2. **假设验证**: 提出 1-2 个核心假设并验证。
3. **修复建议**: 给出直接修复方案。引导至 `/r-dev`。

---

### 🔴 Critical 路径 (P2) - 架构级故障

1. **深度取证**: 识别组件技术栈，切换专家人格。关联 `dev-report` 与 `design-sheet`。
2. **定向假设与 MECE 验证**: 对照领域 `hypothesis_directions`。
3. **诊断结论 (Diagnosis) 产出**: 记录完整证据链，产出 `diagnosis` 产物。
4. **引导**: 引导用户进入 `/r-dev` 修复或 `/r-think` 重设方案。
