# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
