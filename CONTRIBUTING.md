# Contributing to Ritsu

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.0
## Setup

```bash
cd Ritsu/runtime
bun install
```

## Development

```bash
# Build
bun run build

# Test (61 files, 316 tests)
bun run test

# Test single file
bun run test -- tests/session-memory.test.ts

# Lint
bun run lint

# Type check
bunx tsc --noEmit
```

## Guidelines

- **Positive rules**: Write "use const" not "don't use let" — positive rules halve violations
- **Skill vs Rule vs Script**:
  - Needs AI judgment → `skills/<stage>/SKILL.md`
  - Deterministic output → `runtime/src/` (handler or CLI)
  - Always-on guardrail → `rules/anti-patterns.yaml`
- Add `wrong/right/story` examples when adding new anti-patterns
- New features need tests — verify with `bun run test` before PR

## Conventional Commits

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation
- `chore:` maintenance
- `refactor:` code restructure
- `test:` test additions/fixes

## Skill Development

1. Create directory in `skills/<name>/`
2. Provide `SKILL.md` with YAML frontmatter (name, version, tags)
3. Add structured Gotchas table at the bottom
4. Follow `_shared/skill-common-steps.md` protocol

## Code of Conduct

Be respectful and professional in all interactions.
