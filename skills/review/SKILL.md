---
name: review
version: "6.5.0"
description: "Ritsu 最终验收入口。产出《验收单 (Assurance Sheet)》，决定是否可合并、可上线。"
author: "3kaiu"
license: "MIT"
homepage: "https://github.com/3kaiu/Ritsu"
tags: ["review", "assurance", "mcp-server", "audit"]
when_to_use: "/r-review, review, code review, 审查代码, 最终验收"
total_steps: 4
---

# Review: 自适应架构级质量验收

**触发条件**：用户输入 `/r-review`。

## 执行流水线

### 0. 分级判定

> 引用 `_shared/skill-common-steps.md` Step 0

---

### 🟢 Micro 路径 (P0)

1. 对照 Diff 快速审查。
2. 输出「验收通过」，无需 `assurance-sheet`。

---

### 🟡 Standard / 🔴 Critical 路径

#### 1. Preflight（必须）

`ritsu_preflight(stage: review)` — 含 ctx、artifacts、policy 预检、P2 时 trace 摘要与 triple-check 提示。

- policy 未通过 → `assurance.verdict` 必须为 `needs_revision`，禁止 PASS。

#### 2. 证据与审计

- **P1**: 对账 `design-brief` / `dev-report`；红线扫描；可选 `ritsu_write_preference`。
- **P2**: 三方对账 `design.contracts` ↔ `dev.gates` ↔ `assurance.verdict`；仅阅读 preflight 中的 high-risk chunks；违规 `emit_event(violation_detected)`。

#### 3. 产出与归档

- 产出 `assurance-sheet`（P2）。
- `ritsu_close_span`；OpenSpec 项目由 hook 自动 archive（告知用户检查 specs）。

## Gotchas

| What happened | Rule |
|---|---|
| 审查通过但漏掉了硬编码的 API key | Always run regex detector for credentials as part of review |
| 说 "代码没问题" 但实际有编译错误 | Run `bun run build` before signing off |
| 版本号不一致没发现 | Check version in both root and runtime/package.json |
| 新依赖有已知 CVE 但没检查 | Run `npm audit` for new dependencies |
