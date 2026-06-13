# Project Baseline: Ritsu v8.7.0

<!-- Ritsu Configuration Block -->
ritsu-version: 8.2.0
domain: fullstack
host_profile: claude-code
tech_fingerprints:
  - bun
  - typescript
rules_overrides:
  disable: []
  downgrade: []
lint_cmd: bun run --cwd runtime lint
test_cmd: bun run --cwd runtime test
<!-- End Ritsu Block -->

## Technical Stack
- Language: TypeScript
- Runtime: Bun 1.3+
- Core: MCP Server (bun:sqlite storage)
- Skills: Markdown-based protocol (8 stages)

## Active Rules
- Tiered Delivery: Enabled (P0/P1/P2)
- Intent Routing: Enabled (8 skills: init, think, dev, review, hunt, augment, deploy, freestyle)
- Adaptive Memory: Ready (3-tier progressive disclosure)
- Policy Engine: 11 detectors / 20 anti-patterns

## Environment Config
- Ctx Storage: .ritsu/ctx-YYYY-MM.jsonl
- Artifact Storage: .ritsu/
- Vector Store: .ritsu/vectors.db

## AI Loop & Autopilot Guidelines
When you act as an AI agent (e.g. Antigravity, Claude Code, Cursor) in this repository:
1. **DDD & Clean Architecture**: Follow Clean Architecture (no reverse dependencies from Domain to Infrastructure/Application) and DDD principles (high module cohesion, low coupling, no micro-file sprawl).
2. **Auto Quality Gates**: Before proposing any code changes or declaring a task complete, you MUST run `ritsu_run_quality_gates` (or run `bun run --cwd runtime test` / `ritsu check --staged` in terminal) to check for tests, linting, and policy compliance.
3. **Self-Correction**: If any checks fail, you MUST NOT ask the user for help immediately. Enter a self-correction loop (up to 3 times) to fix the errors and re-run quality gates.
4. **Emit Progress Events**: Keep the lifecycle synced by calling the `ritsu_emit_event` tool whenever you start, succeed, or fail a task step.
5. **Trigger Loops**: You can trigger a scheduled loop in the background or foreground using `ritsu loop trigger <loop-id>` (e.g. `test-augment`, `pr-review`, `think-refinement`).
6. **Design-Stage Think Loop**: Trigger the refinement loop (`ritsu loop trigger think-refinement`) and ensure designs compare alternative algorithms (Big-O analysis) and architectural options (trade-off decision matrix) satisfying DA-1 to DA-6.
