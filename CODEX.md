# Ritsu for Codex CLI

Ritsu works with Codex CLI via the `CODEX.md` workflow file.

Ritsu 通过 `CODEX.md` 与 Codex CLI 协同工作。

## Install / 安装

```bash
npx skills add 3kaiu/Ritsu -a codex -g -y
```

## Quick Start / 快速开始

```bash
ritsu doctor
ritsu bootstrap --demo
ritsu violations
```

## Commands / 命令

| Command | 作用 |
|---------|------|
| `/r-think` | 架构分析与设计 |
| `/r-dev` | 策略强制编码 |
| `/r-review` | 质量验收 |
| `/r-deploy` | 部署门禁 |
| `/r-hunt` | 根因诊断 |

## Build & Test / 构建与测试

```bash
bun run --cwd runtime build
bun run --cwd runtime test
```

See `CLAUDE.md` for the complete protocol guide / 完整指南见 `CLAUDE.md`。
