# Ritsu for Codex CLI

Ritsu works with Codex CLI via the `CODEX.md` workflow file. Codex CLI reads this file at session start.

## Install

```bash
npx skills add 3kaiu/Ritsu -a codex -g -y
```

## Quick Start

```bash
ritsu doctor           # Verify the environment
ritsu bootstrap --demo # Generate demo data
ritsu violations       # See live violation tracking
```

## Slash Commands in Codex

| Command | What it does |
|---------|-------------|
| `/r-think` | Architecture analysis + design contracts |
| `/r-dev` | Policy-enforced implementation |
| `/r-review` | Quality assurance with evidence |
| `/r-deploy` | Deployment plan + rollback |
| `/r-hunt` | Root cause diagnosis |

## Build & Test

```bash
bun run --cwd runtime build
bun run --cwd runtime test
```

## Reference

See `CLAUDE.md` for the complete protocol guide.
