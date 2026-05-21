# Ritsu — AI Delivery Workflow Engine

Ritsu orchestrates AI-assisted software delivery through a 4-stage deterministic lifecycle: **Think → Dev → Review → Hunt**.

## Quick Start

```bash
# Build & Test
bun run --cwd runtime build
bun run --cwd runtime test

# Dev mode (hot reload)
bun run --cwd runtime dev

# Lint
bun run --cwd runtime lint

# Ritsu CLI
bun run --cwd runtime dist/cli.js doctor
```

## Architecture

- **Runtime**: `runtime/` — Node.js MCP server (TypeScript), ALL source in `runtime/src/`
- **Skills**: `skills/<stage>/SKILL.md` — Markdown protocol instructions per stage
- **Policies**: `rules/anti-patterns.yaml` — Rule engine with regex/cross-file/ast-grep detectors
- **Shared schemas**: `_shared/` — MCP tool YAML, artifact templates, event schemas
- **Native engine**: `runtime/native/` — Rust napi-rs addon for vector search (optional, graceful fallback)

## IMPORTANT Conventions

### Code Style
- Always use `const` or `let` — never `var`
- Prefer explicit TypeScript types over inference for public API surfaces
- All source in `runtime/src/` — tests mirror in `runtime/tests/`
- Named exports everywhere

### Ritsu Workflow
- ALWAYS use `ritsu_span_lifecycle` to open/close spans (not deprecated `ritsu_open_span`/`ritsu_close_span`)
- ALWAYS use `ritsu_inspect_git_changes` for diff inspection (not deprecated `ritsu_get_diff`/`ritsu_diff_chunks`)
- ALWAYS use `ritsu_file_lease` (not deprecated `ritsu_claim_file`/`ritsu_release_file`/`ritsu_list_leases`)
- ALWAYS use `ritsu_task_coordination` (not deprecated `ritsu_claim_task`/`ritsu_list_pending_tasks`)

### Error Handling
- Return structured errors via `structuredError(type, code, message, opts?)` from `handlers/_utils.ts`
- Error types: `PolicyViolation` | `ValidationError` | `ExecutionError` | `InternalError`
- NEVER use `process.exit(1)` in handler code — throw or return error instead

### Storage
- Ctx events are stored in `.ritsu/ctx-YYYYMM.jsonl` (JSONL) with dual-write to `.ritsu/ctx.db` (SQLite, bun:sqlite)
- ALWAYS write through `ctx-writer.ts` (not direct file append) — it handles locking + correlation_id generation
- Use `readAllEntries` / `readRecentEntries` / `readLastIncomplete` / `readLastCompleted` from `ctx-reader.ts`
- SQLite is preferred for reads when available (tryOpenSqlite lazy init)

## Decision Table: Skill vs Rule vs Script

When adding new functionality to Ritsu, use this table to decide where it belongs:

| Question | Yes → | No → |
|----------|-------|------|
| Does the user need judgment, adaptation, or follow-up questions? | **Skill** (`skills/<name>/SKILL.md`) | Script or Rule |
| Does the same input always produce the same output? | **Script** (`runtime/src/cli/` or deterministic tool) | Skill or Rule |
| Does behavior shift with conversation context? | **Skill** | Script or Rule |
| Is it an always-on behavioral guardrail for the AI? | **Rule** (`rules/anti-patterns.yaml`) | Skill or Script |

- **Skills**: Adaptive, AI-judgment-driven Markdown prompts. Live in `skills/<stage>/SKILL.md`.
- **Scripts/Handlers**: Deterministic code. Live in `runtime/src/` (handlers, CLI commands).
- **Rules**: Always-on constraints in `rules/anti-patterns.yaml`. Add WRONG/RIGHT examples.

### Policy Engine
- Built-in detectors are in `runtime/src/policy/detectors/`
- User-defined detectors go in `<project-root>/rules/detectors/*.js` exporting `createDetector()`
- See `runtime/src/policy/detectors/custom.example.ts` for reference

## Gotchas
- `ritsu_exec` does **not** support pipes/redirects/shell metacharacters — chain multiple calls
- `proper-lockfile` is used for async file locking on ctx writes
- The `native/` Rust addon is optional — all features have JS fallbacks
- `package-lock.json` is removed — use `bun` (not `npm`) for dependency management
