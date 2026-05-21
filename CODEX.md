# Ritsu — AI Delivery Workflow Engine

See `CLAUDE.md` for the complete AI onboarding guide. This file exists for Codex CLI compatibility — all relevant content is in `CLAUDE.md`.

## 快速参考

```bash
bun run --cwd runtime build   # 编译
bun run --cwd runtime test    # 测试 (342 tests)
```

工作流: `/r-think` → `/r-dev` → `/r-review` → `/r-hunt`

Ritsu 的 MCP 服务器提供 22 个工具。启动后运行 `ritsu doctor` 检查状态。
