# Ritsu Quality Gates & Autopilot Loop (Claude Code)

This rule forces the AI agent to automatically execute Ritsu's loops and verification checks.

## Guidelines
1. **DDD & Clean Architecture First**: When creating or modifying code, you MUST follow Clean Architecture (no reverse dependencies from Domain to Infrastructure/Application) and DDD principles (high module cohesion, low coupling).
2. **File Naming & Clean Imports**: Name files logically after their domain functions. Avoid generic files like `utils.ts` or scattered single-interface files. Delete dead code, empty files, and unused imports.
3. **Design-Stage Think Loop & D2C Integration**: Before coding a complex task, you MUST trigger the Ritsu design refinement loop (`ritsu loop trigger think-refinement`) or run Ritsu preflight to verify your design-sheet. Make sure all proposed changes pass design guardrails (DA-1 to DA-7). **If the goal or task contains a MasterGo URL/content, you MUST automatically run the D2C workflow**: call `mastergo-mcp` tools to fetch design sections, SVGs, and texts, compile them into `d2c-spec.json` using `ritsu_d2c_compile`, and integrate the spec/structure into `design-sheet.md` (DA-7) before transitioning to the `dev` stage.
4. **Trigger Quality Gates Automatically**: Before proposing any file modifications or declaring a task complete, you MUST invoke the MCP tool `ritsu_run_quality_gates` (or run `bun run --cwd runtime test` / `ritsu check --staged` or `ritsud check [staged_files]` in terminal) to verify tests, lint, and policy compliance.
5. **Execute Self-Correction Loops**: If quality gates or design verification fail, DO NOT ask the user for help. Enter a self-correction loop (up to 3 iterations): inspect error logs, modify the code/design, and run verification again.
6. **Emit Progress Events**: Keep Ritsu's task context synchronized by emitting lifecycle events (`started`, `done`, `failed`) via the `ritsu_emit_event` MCP tool.
7. **Preflight Check**: Run `ritsu_preflight` when starting any new task.