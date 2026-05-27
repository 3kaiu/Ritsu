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

> **⚡️ Prompt Topology** — 三段式不可交叉：`anti-patterns.yaml` + `mcp-tools.yaml` + `rules/review-redlines.yaml`（Stage 1）→ this file（Stage 2）→ `_suffix: true` 数据（Stage 3，末尾）。

**触发条件**：用户输入 `/r-review`。

## 执行流水线

### -1. Prompt Caching 对齐

> 引用 `_shared/skill-common-steps.md` Step -2。优先构建静态基座（`rules/anti-patterns.yaml` + `_shared/mcp-tools.yaml`）后，再进入后续动态流程。

### 0. 分级判定

> 引用 `_shared/skill-common-steps.md` Step 0

---

### 🟢 Micro 路径 (P0)

1. 对照 Diff 快速审查。
2. 输出「验收通过」，无需 `assurance-sheet`。

---

### 🟡 Standard / 🔴 Critical 路径

#### 1. Preflight（必须）

`ritsu_preflight(stage: review)` — 含 ctx、artifacts、policy 预检、P2 时 trace 摘要与 triple-check 提示、架构漂移检测。

架构上下文参考 AGENTS.md Architecture Block（模块边界和依赖规则）。

- policy 未通过 → `assurance.verdict` 必须为 `needs_revision`，禁止 PASS。

#### 2. 证据与审计

- **P1**: 对账 `design-brief` / `dev-report`；红线扫描；可选 `ritsu_write_preference`。
- **P2**: 三方对账 `design.contracts` ↔ `dev.gates` ↔ `assurance.verdict`；仅阅读 preflight 中的 high-risk chunks；违规 `emit_event(violation_detected)`。
- **P2 契约验证**: 如果质量门禁中包含 `contract_verification` 数据，直接引用其 per-contract status 作为 assurance-sheet `contract_verdict` 的证据。对于 `partial` 状态的契约，在 assurance-sheet 中标记为 `needs_revision`。
- **P2 违规对账**: Preflight 中包含来自 violation tracker 的未解决违规列表。审查时确认：
  - 所有 open 违规是否确实已解决或误报
  - 是否有新引入的违规未被 tracker 捕获
  - 对于严重违规 (fatal/hard_stop)，确保在 assurance.verdict 中标记。

#### 2b. 🔀 多 Agent 交叉审查

当 dev 阶段使用了多 Agent (`ritsu_dispatch_task`)，review 阶段增加交叉审查检查：

1. **检查 divergence_rate**: `ritsu_dispatch_task` 返回值中的 `divergence_rate` > 0.3 意味着超过 30% 的 Agent 输出有冲突，需要人工介入
2. **审查冲突列表**: 逐条检查 `conflicts` 数组：
   - `file_collision`: 同一文件被多个 Agent 修改 → 确认合并是否正确
   - `quality_divergence`: Agent 间质量门禁结果不一致 → 重新运行质量门禁
   - `design_divergence`: Agent 间对需求理解不一致 → 回退到 think 阶段
3. **验证交叉审查结果**: `cross_reviews` 中若任何一个 reviewer 报告了 violation，需在 assurance-sheet 中记录

#### 3. 产出与归档

- 产出 `assurance-sheet`（P2）。
- `ritsu_span_lifecycle action=close`；由 hook 自动归档（告知用户检查 specs）。

## Gotchas

| What happened | Rule |
|---|---|
| 审查通过但漏掉了硬编码的 API key | Always run regex detector for credentials as part of review |
| 说 "代码没问题" 但实际有编译错误 | Run `bun run build` before signing off |
| 版本号不一致没发现 | Check version in both root and runtime/package.json |
| 新依赖有已知 CVE 但没检查 | Run `npm audit` for new dependencies |
