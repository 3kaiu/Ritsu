# Ritsu — AI Code Quality Gate

Ritsu is a policy engine + quality gates + session recovery for AI coding agents.
It runs alongside Claude Code, Cursor, or Codex CLI.

Ritsu 是 AI 编码代理的策略引擎 + 质量门禁 + 会话恢复系统。

## 8 Slash Commands / 指令

| Command | Stage | 阶段 |
|---------|-------|------|
| `/r-think` | Design | 架构分析与设计 |
| `/r-dev` | Code | 策略强制编码 |
| `/r-review` | Review | 质量验收 |
| `/r-deploy` | Deploy | 部署门禁 |
| `/r-hunt` | Debug | 根因诊断 |
| `/r-augment` | Tests | 补测引擎 |
| `/r-init` | Init | 项目初始化 |
| `/r-freestyle` | Q&A | 快速问答 |

## Quick Start / 快速开始

```bash
npx skills add 3kaiu/Ritsu -a claude-code -g -y
ritsu doctor
ritsu bootstrap --demo  # Try demo / 体验 demo
ritsu violations --open # List violations / 查看违规
```

## Architecture / 架构

```
Agent writes code → Policy engine (11 detectors) → Quality gates → Session checkpoint
                  → Violation tracker → Contract verification → Agent analytics
```

## Prompt Caching Protocol / 缓存协议

3-stage topology:
1. **Stage 1 (Static Prefix)**: `anti-patterns.yaml` + `mcp-tools.yaml`
2. **Stage 2 (Skill Guide)**: The specific `SKILL.md`
3. **Stage 3 (Suffix Zone)**: Dynamic data, marked `_suffix: true`

**Critical**: Do not mix dynamic data into Stage 1 or 2. All dynamic context must use `_suffix: true`.

## Quality Gates / 质量门禁

`ritsu_run_quality_gates` runs lint + test + coverage check. Core modules (auth, payment) require 100% coverage; periphery passes on compilation.

## Session Recovery / 会话恢复

Auto-saves checkpoint at every step. On next session, injects recovery context.

## Troubleshooting / 故障排除

| Problem / 问题 | Check / 检查 |
|---------------|-------------|
| `ritsu doctor` fails | `bun --version` >= 1.3.0 |
| Slash commands not loading | Restart Claude Code, check `.mcp.json` |
| Policy violation unclear | `ritsu violations --open` for details |
