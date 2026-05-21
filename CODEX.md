# Ritsu — AI Delivery Skill Engine

See `CLAUDE.md` for the complete guide.

Ritsu 是一个 **skill + engine**：表现为 6 个 skill 指令，底层自动编排其他工具和协议。

```bash
bun run --cwd runtime build   # 编译
bun run --cwd runtime test    # 测试
```

工作流: `/r-think` → `/r-dev` → `/r-review` → `/r-hunt`
安装: `npx skills add 3kaiu/Ritsu -a claude-code -g -y`
检查: `ritsu doctor`
