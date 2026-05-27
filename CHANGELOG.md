# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [8.8.0] - 2026-05-27

### Added
- Semantic Test Oracle: Level 3 contract verification via Istanbul branch coverage
  - `test-oracle.ts`: reads Istanbul v8 `coverage-final.json` with per-function and per-branch data
  - Maps contract descriptions to function names via keyword extraction
  - Verifies each matched function is actually EXERCISED (hit count > 0)
  - Reports uncovered branches per function
  - Distinguishes "function exists and is covered" from "function exists but only happy path covered"
- `contract-verification.ts`: `checkLevel3` is no longer a stub — reads real coverage data
  - Searches common coverage paths (coverage/, .ritsu/, runtime/coverage/)
  - Returns per-function hit counts and per-branch coverage status
- Exported `extractKeyPhrases` from contract-verification.ts
- 7 new test-oracle tests

## [8.7.1] - 2026-05-27

### Added
- Orchestration layer test coverage: 71 test files, 502 total tests (+23)
  - `policy-preflight.test.ts` (new, 7 tests): `parseChangedPaths`, cache, empty workspace
  - `diff-inspect.test.ts` extended (7 new): `inspectDiff` stat/chunks/full modes, cached, error handling, truncation
  - `preflight-runner.test.ts` extended (9 new): inferTier, P2 think, detail=true disclosure, policy recovery, JSON parse failure recovery
- Exported `parseChangedPaths` from `policy-preflight.ts` for testability

## [8.7.0] - 2026-05-27

### Added
- Release workflow: `.github/workflows/release.yml` — builds + tests + publishes to npm on `v*` tag push
- `.gitattributes`: LF line endings, export-ignore for CI artifacts
- npm `publishConfig` with `access: public`

### Changed
- CI workflow: removed 7-failure tolerance gate (all 479 tests pass), added coverage output
- `runtime/package.json`: cleaned up `files` field (only `dist/` shipped, no `bun.lock`)
- `runtime/scripts/copy-resources.js`: removes `__mocks__` from dist after build
- README badges: replaced static version with live npm badge

## [8.6.0] - 2026-05-27

### Removed
- Dead handler registrations: `ritsu_patch_artifact`, `ritsu_file_lease`, `ritsu_task_coordination` removed from handler registry (functions still exist internally, but were unreachable via MCP — only `ritsu_coordination` is exposed)
- `_shared/mcp-tools-internal.yaml`: empty file (`tools: []`), served no purpose
- `cli.ts` backward-compat re-exports: removed 14 lines re-exporting utility functions "for tests" — tests now import directly from `cli/shared.js`

### Changed
- Handler registry: 27 → 24 entries
- `_shared/mcp-tools.yaml`: artifact type enum now includes `deploy-plan` and `deploy-report` (were orphaned templates with no type entry)
- `runtime/src/shared.ts`: ARTIFACT_REGISTRY and ARTIFACT_VALID_TYPES now include deploy-plan and deploy-report

## [8.6.0] - 2026-05-27

### Fixed
- Test infrastructure: 10 failing test suites → 0 (bun:sqlite mock via vitest alias)
  - Created `src/__mocks__/bun-sqlite.ts` with minimal Database class
  - Updated vitest config with resolve.alias for bun:sqlite
  - Fixed version assertion in cli.test.ts (hardcoded 8.0.0)
  - Added RITSU_DISABLE_SQLITE=1 guard in ctx-reader-resilience test
  - Tests: 479/479 all passing (was 70/70 files, 479/479 tests — truly zero failures)
- Fixed coverage config to include src/tests/ files

### Changed
- Extracted CoverageAdapter family from run-quality-gates.ts (848→550 lines)
  - `src/coverage-adapters.ts`: 4 adapters + cache + routing logic
  - `src/test-report-adapters.ts`: 2 adapters + runner detection + arg injection
  - run-quality-gates.ts now imports from both, reducing coupling
- Updated test imports to match new module locations

### Added
- `ritsu bootstrap --demo`: generates sample project data in .ritsu/
  - Demo design-sheet with 3 contracts
  - Sample ctx events with violations
  - Pre-populated violations.json and contracts.json
  - Quality gate snapshot with contract verification
  - New users can immediately run `ritsu violations` / `ritsu report`

## [8.5.0] - 2026-05-27

### Changed
- Storage layer consolidation: extracted 15 duplicated "read JSON → modify → write JSON" patterns into a single `DataStore` abstraction
  - `DataStore<T>` wraps `locked-json.ts` with atomic writes via temp+rename
  - `update()` is a single atomic read→modify→write operation (no window)
  - Auto-creates parent directories
  - Consistent error handling (returns defaults on read failure)
- Migrated `contract-registry.ts` and `violation-tracker.ts` to use DataStore
  - Removed ~60 lines of duplicated read/write code
  - All writes now atomic (temp file + renameSync)
- Removed exported `readRegistry`/`writeRegistry` from contract-registry (now internal)

### Added
- 10 new DataStore tests: read/write/update/atomicity/corruption/concurrent

## [8.4.0] - 2026-05-27

### Added
- Violation Tracker: persistent open-violations lifecycle manager
  - Deduplicated capture from policy engine, quality gates, and manual emit
  - Lifecycle: open → acknowledged → fixed/wont_fix/false_positive
  - Automatic file path extraction from evidence strings
  - Git commit SHA linking
  - `ritsu violations` CLI: list open, per-file grouping, monthly trend
  - `ritsu violations resolve <id>`: mark violations as fixed
- Context lifecycle now reads violation tracker for open violations
- Review/dev skills reference violation tracker in preflight

### Changed
- Tests: 389 → 400 (+11)

## [8.3.0] - 2026-05-27

### Added
- Contract Registry: structured `.ritsu/contracts.json` replacing ad-hoc regex parsing
  - Auto-synced on design-sheet write
  - Per-contract status lifecycle (pending → verified/partial/failed/deprecated)
  - Query interface for all consumers (quality gates, review, multi-agent)
- Contract Verification Engine: three-level verification pipeline
  - Level 1 (Structural): test file exists at hinted path
  - Level 2 (Content): test file references contract by annotation, describe block, or keyword
  - Level 3 (Semantic): stub for future call-trace matching
  - Per-contract verdict + evidence for assurance-sheet
  - Integrated with quality gates via `verify_contracts: true`
- Assurance-sheet template: added contract_verdict table section

### Changed
- Tests: 379 → 389 (+10)
- Design-sheet writes now sync contracts to registry automatically

## [8.2.0] - 2026-05-27

### Added
- Multi-Agent Orchestration Engine: split design-sheet contracts across parallel agents
  - `ritsu_dispatch_task` MCP tool: analyze, split, dispatch, cross-review, conflict detection
  - `ritsu_launch_agent` MCP tool: spawn Claude Code / Codex subprocesses with trace propagation
  - Intelligent task analysis: detects multi-domain tasks (frontend + backend) for natural splitting
  - Domain-aware contract grouping: UI contracts → frontend agent, API contracts → backend agent
  - Cross-review protocol: agents review each other's code for independent verification
  - Conflict detection: file collisions, quality divergence, design divergence
  - Divergence rate metric: quantitative measure of agent agreement/disagreement

### Changed
- MCP tools: 24 → 26 (added ritsu_launch_agent, ritsu_dispatch_task)
- Tests: 328 → 379 (+51)
- Skills: dev + review updated with multi-agent P2 paths

## [8.1.0] - 2026-05-27

### Added
- `/r-deploy` Deploy Gate: new deploy stage completing the delivery pipeline
- `deploy-plan` artifact type with rollback/strategy/monitoring/post-deploy schemas
- `deploy-report` artifact type for quick deploy summaries
- Test Quality Intelligence engine: assertion density, snapshot-only detection, contract coverage
- `ritsu report` CLI command: agent behavior analytics and cost insights
- Agent analytics engine: quality trends, cost breakdown, top violations, slow spans
- Context Lifecycle Manager: checkpoint-based session recovery for AI coding agents
  - Auto-checkpoint at step completion / artifact write / task failure
  - Recovery prompt generation: new sessions know what they were doing
  - Token budget tracking with compression trigger at 85% utilization
  - Checkpoint pruning: rolling window of 20 most recent checkpoints
  - Recovery context injection via preflight (`_recovery` field)
  - HMAC-aware: tracks active violations, contracts, and working files across sessions
  - Zero new dependencies: uses bun:sqlite + JSONL checkpoint store

### Changed
- Skills: 7 → 8 (added deploy stage)
- Protocol version: 8.0.0 → 8.1.0

## [8.0.0] - 2026-05-22

### Added
- 4 new policy detectors: security_smell (R-6), contract_drift (R-4), SQL DROP (R-5), empty-catch (AP-7)
- Blast Radius: transitive dependency BFS expansion for scan_files
- ImportGraph: in-process symbol-level dependency graph (CodeGraph fallback)
- IDE Rule Active Sync: architecture context auto-pushed to .cursor/rules/ + .claude/rules/
- Token Squeezer: budget-aware priority-based response truncation
- Progressive Disclosure: 3-level auto-melter (normal → risk chunks → full context)
- Adaptive Coverage Threshold: core (100%) / periphery (compile-only) by risk level
- Per-stage cache prefix: dev-guardrails.yaml + review-redlines.yaml
- Multi-agent coordination: agent_status tool + unified coordination tool
- Heuristic rule extraction: 5 built-in patterns + Jaccard clustering
- Jaccard/Cosine unified into shared similarity.ts

### Changed
- Anti-pattern detectors: 7/20 → 11/20 rules instrumented
- MCP tools: 22 → 8 (patch→write_artifact, file_lease+task→coordination)
- Tests: 269 → 316 (+47 new tests)
- Architecture: 5 layers → 6 layers (added Learning layer)
- Static prefix split: dev + review stage-specific rule files

### Fixed
- Violation events: log warnings instead of silent discard
- Signature payload: include correlation_id, skill, domain
- Loader: warn when reconcilePreferences fails
- CodeQL js/incomplete-sanitization in openspec-bridge.ts

### Removed
- Rust napi-rs native engine (replaced with bun:sqlite)

## [7.3.0] - 2026-05-22

### Added
- AST cache pre-warming with shared memory across detectors
- Custom CompilerHost for zero-IO TypeScript compilation
- Handler consolidation: 9 files → 4 modules

### Changed
- CI: single runner, bun caching, concurrency cancellation
- Dependabot: removed stale Cargo section, added major-version ignores

## [7.0.0] - 2026-05-22

### Added
- Architecture drift detection: module discovery, dependency extraction, preflight comparison
- Cross-session memory: 3-tier progressive disclosure
- Policy plugin system: manifest.json + custom detector hot-reload
- Token budget control: ritsu_read_ctx token_budget parameter
- doctor --signals and doctor --ai commands

### Changed
- Migrated to Bun 1.3+ (native engine replaced with bun:sqlite)
- MCP tools consolidated
- Error format unified (RitsuToolError)

### Fixed
- Shell injection in Git commands
- Version number alignment

## [6.5.0] - 2026-05-21

### Added
- Adaptive preference mining
- Self-contained npx installer

[8.0.0]: https://github.com/3kaiu/Ritsu/compare/v7.3.0...v8.0.0
[7.3.0]: https://github.com/3kaiu/Ritsu/compare/v7.0.0...v7.3.0
[7.0.0]: https://github.com/3kaiu/Ritsu/compare/v6.5.0...v7.0.0
[6.5.0]: https://github.com/3kaiu/Ritsu/releases/tag/v6.5.0
