---
name: hunt
version: "6.5.0"
description: "Ritsu 技术诊断入口。通过取证与假设验证锁定根因，并给出修复建议。"
author: "3kaiu"
license: "MIT"
homepage: "https://github.com/3kaiu/Ritsu"
tags: ["debug", "troubleshooting", "mcp-server", "diagnostics"]
when_to_use: "/r-hunt, 报错了, 排障, 诊断, debug, 找不到问题在哪"
total_steps: 4
---

# Hunt: 自适应技术诊断与排障

**触发条件**：用户输入 `/r-hunt`。

## 执行流水线

### -1. Prompt Caching 对齐

> 引用 `_shared/skill-common-steps.md` Step -2。优先构建静态基座（`rules/anti-patterns.yaml` + `_shared/mcp-tools.yaml`）后，再进入后续动态流程。

### 0. 分级判定

> 引用 `_shared/skill-common-steps.md` Step 0

---

### 所有路径：Preflight（必须）

`ritsu_preflight(stage: hunt)` — 自动提供：
- `recovery_context`（断点续传）
- `changed_files`、top risk `chunks`
- `similar_violations`（历史 ctx 相似违规）

仅基于 `context_pack` 定向读文件与日志；第三方库 API 用 Context7 等 doc MCP（见 [docs/integrations.md](../docs/integrations.md)）。

---

### 🟡 Standard 路径 (P1)

1. **快速取证**: 报错/堆栈与 preflight 交叉验证。
2. **假设验证**: 1–2 个核心假设。
3. **修复建议** → 引导 `/r-dev`。

---

### 🔴 Critical 路径 (P2)

1. **深度取证**: 关联 `dev-report` / `design-sheet`；领域 `hypothesis_directions`。
2. **产出 `diagnosis`**（完整证据链）。
3. **引导** `/r-dev` 或 `/r-think`。

## Gotchas

| What happened | Rule |
|---|---|
| 调试了 2 小时发现是 .env 配置问题 | Always check env config first — most failures are configuration, not code |
| 连续 3 次根因猜测都错了 | Maximum 3 hypotheses before escalating — gather more evidence |
| 修复了一个 bug 但同类 bug 还有 3 处 | After fixing, `grep` for sibling patterns before closing |
