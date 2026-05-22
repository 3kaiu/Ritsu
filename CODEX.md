# Ritsu — AI Delivery Skill Engine

See `CLAUDE.md` for the complete guide.

Ritsu is a **skill + engine**: 7 skill commands, backed by an 11-detector policy engine and 8 MCP tools.

```bash
bun run --cwd runtime build   # Build
bun run --cwd runtime test    # Test (316 tests)
```

Workflow: `/r-init` → `/r-think` → `/r-dev` → `/r-review` → `/r-hunt`
Install: `npx skills add 3kaiu/Ritsu -a claude-code -g -y`
Check: `ritsu doctor`
