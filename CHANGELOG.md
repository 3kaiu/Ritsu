# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [7.0.0] - 2026-05-22

### Added
- Rust napi-rs native engine: vector search + ctx storage (sqlite-vec)
- Architecture drift detection: module discovery, dependency extraction, preflight comparison
- Cross-session memory: 3-tier progressive disclosure
- Superpowers workflow bridge: internal brainstorming and phase mapping
- CodeGraph integration: codegraph detector, preflight context
- OpenSpec /opsx: command support
- Policy plugin system: manifest.json + custom detector hot-reload
- Waza patterns: anti-pattern examples, Gotchas tables, verification-first hard stop
- Token budget control: ritsu_read_ctx token_budget parameter
- Phase-aware artifact validation
- doctor --signals and doctor --ai commands

### Changed
- Migrated from npm to Bun 1.3+
- MCP tools consolidated from 28 to 22
- CLI split into 9 submodules
- Error format unified (RitsuToolError)
- proper-lockfile removed (Rust WAL concurrency)
- domains/ removed (AGENTS.md sufficient)

### Fixed
- Shell injection in Git commands
- Version number alignment
- Unicode regex for Chinese claims

## [6.5.0] - 2026-05-21

### Added
- Adaptive preference mining
- Self-contained npx installer
- Skills CLI metadata

[7.0.0]: https://github.com/3kaiu/Ritsu/compare/v6.5.0...v7.0.0
[6.5.0]: https://github.com/3kaiu/Ritsu/releases/tag/v6.5.0
