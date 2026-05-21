# Ritsu Roadmap (2026-05 → 2027-05)

> 北极星：让 AI 生成的代码质量持续上升 → 测试可机器追溯到契约 → review 能扛大 PR + 跨 PR 有记忆。

## 当前状态 (v7.0 — 2026-05)

| 维度 | 状态 |
|------|------|
| Core | Bun 迁移完成、60 测试文件 / 344 测试全覆盖 |
| 生态 | 5 个外部项目融合 |
| Claude Code | CLAUDE.md + .claude/rules/ + .claudeignore 完备 |
| 原生 | Rust napi-rs 引擎 (darwin-arm64) |
| CI | Bun + Rust 交叉编译 |

## v7.x — 质量 & 团队 (2026-06 → 2026-09)

- [ ] Rust 原生引擎交叉编译 (darwin-x64, windows-x64)
- [ ] HTTP MCP Transport (ritsu serve)
- [ ] 策略 Dashboard (Web UI)
- [ ] 团队级 shared policy server

## v8.0 — AI 原生 (2026-10 → 2027-03)

- [ ] 多模型路由 (按阶段自动选择最优模型)
- [ ] Agent 协商协议
- [ ] Embedding 语义检索 (替代 Jaccard)
- [ ] LLM 驱动规则合成 (当前已支持, RITSU_LLM_ENABLED)

## v9.0 — 平台 (2027-04+)

- [ ] 插件市场
- [ ] 可视化 Trace 分析
- [ ] 自托管 Server 模式
