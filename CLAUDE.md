# Ritsu — AI Code Quality Gate

Ritsu is a policy engine + quality gate + session recovery system for AI coding agents. It runs alongside Claude Code, Cursor, or Codex CLI and ensures AI-generated code is correct, secure, and consistent.

## Quick Start

```bash
# 1. Add Ritsu to your project
npx skills add 3kaiu/Ritsu -a claude-code -g -y

# 2. Check the environment
ritsu doctor

# 3. Initialize in Claude Code
/r-init

# Or try the demo mode (no project needed):
ritsu bootstrap --demo
ritsu violations
ritsu report
```

## Slash Commands

| Command | Stage | What it produces |
|---------|-------|-----------------|
| `/r-think` | Design | Architecture analysis, design-sheet with contracts |
| `/r-dev` | Code | Policy-enforced code, quality gates passed |
| `/r-review` | Review | Assurance sheet: mergeability + deployability |
| `/r-deploy` | Deploy | Rollback plan, canary strategy, smoke tests |
| `/r-hunt` | Debug | Root cause diagnosis with evidence chain |
| `/r-augment` | Tests | Coverage gap analysis + targeted test generation |
| `/r-init` | Init | Project baseline (AGENTS.md, ecosystem config) |
| `/r-freestyle` | Q&A | Direct answer, no workflow |

## How It Works

When an AI coding agent runs a slash command, Ritsu intercepts the workflow:

```
Agent writes code → Policy engine checks (11 detectors)
                  → Quality gates (lint + test + coverage)
                  → Checkpoint saved (for session recovery)
                  → Violation tracked (if any)
```

The policy engine catches what the agent misses: scope creep (AP-4), security vulnerabilities (R-6), architecture drift (R-8), credential leaks (R-3), contract changes (R-4), and 15 more anti-patterns.

## Architecture

```
skills/             8 SKILL.md instruction files
rules/              20 anti-patterns + ast-grep + guardrails
_shared/            MCP tool schemas + JSON Schema + protocols
runtime/src/
  handlers/         24 MCP tool handlers
  policy/           11 detectors + blast radius + import graph
  orchestration/    preflight, diff-inspect, multi-agent, architecture
  cli/              doctor, bootstrap, report, violations, ...
```

### Prompt Caching Protocol

Ritsu uses a 3-stage prompt topology for cache efficiency:

1. **Stage 1 (Static Prefix)** — Loaded once, cached across calls:
   - `rules/anti-patterns.yaml` (always)
   - `_shared/mcp-tools.yaml` (always)
   - `rules/dev-guardrails.yaml` (only during `/r-dev`)
   - `rules/review-redlines.yaml` (only during `/r-review`)

2. **Stage 2 (Skill Guide)** — The specific SKILL.md for the current command

3. **Stage 3 (Suffix Zone)** — Dynamic data, marked with `_suffix: true`:
   - Context, diff, artifacts, policy results, recovery prompts

**Critical**: Do not mix dynamic data into Stage 1 or 2. Cache prefix data must remain static across calls. All dynamic context must go in Stage 3 with `_suffix: true`.

## Project Baseline (AGENTS.md)

After `/r-init`, the project has an `AGENTS.md` file with a YAML configuration block:

```yaml
ritsu-version: 8.6.0
domain: fullstack
host_profile: claude-code
tech_fingerprints:
  - bun
  - typescript
lint_cmd: bun run lint
test_cmd: bun run test
```

This defines the project's tech stack, domain, and test/lint commands used by quality gates.

## Quality Gates

`ritsu_run_quality_gates` runs three checks:

1. **Lint** — Runs the project's linter
2. **Test** — Runs tests with coverage
3. **Coverage Threshold** — Core modules (auth, payment, crypto) require 100% line coverage; periphery passes on compilation

Gate results are saved to `.ritsu/last-quality-gate.json` and checked during `/r-dev` completion.

## Session Recovery

If a session ends unexpectedly (timeout, crash, terminal close), the next session auto-detects the interruption and injects a recovery prompt:

```
📋 Session Recovery (hot)
Skill: dev | Step 3/5
Done: created models, implemented routes
Pending: add tests, quality gates, deliver
Active violations: none
Working files: models/order.ts, routes/order.ts
```

## Troubleshooting

| Problem | Check |
|---------|-------|
| `ritsu doctor` fails | Run `bun --version` (need >=1.3.0). Check `.ritsu/` directory exists. |
| Slash commands not loading | Restart Claude Code after `skills add`. Check `.claude/settings.json` for MCP entry. |
| Quality gates fail | Run lint/tests separately to confirm they pass outside Ritsu. |
| Policy violation unclear | Run `ritsu violations` for details. Each violation has evidence (file:line). |
| Demo data not showing | Run `ritsu bootstrap --demo` then `ritsu violations --open`. |
