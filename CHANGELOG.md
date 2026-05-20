# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [6.5.0] - 2026-05-15

### Added
- **Multi-Agent Coordination**: `coordination-sheet` and span inheritance via `RITSU_TRACE_PARENT`.
- **HMAC Trace Signing**: Centralized event signing for distributed trust.
- **File Lease Protocol**: `claim_file` and `release_file` for multi-agent concurrency control.
- **Task Claiming**: `claim_task` and `list_pending_tasks` for coordinated execution.

## [6.0.0] - 2026-05-15

### Added
- **AST Detector**: Structural analysis for identifier validation and structural integrity.
- **Preference Detection**: Automated project convention enforcement via `preference_lint`.
- **Triple Verification CI**: Protocol for Design ↔ Dev ↔ Assurance alignment.
- **Health Dashboard**: 4 key metrics (interception rate, promotion rate, coverage, process completeness).
- **Strict Mode**: `RITSU_STRICT_OUTPUT` default-on for dev environment.

## [5.6.0] - 2026-05-15

### Added
- MIT License.
- Root `.gitignore` and comprehensive CI workflow.
- `CONTRIBUTING.md`, `SECURITY.md`, and issue/PR templates.
- Unit tests for `list-artifacts`, `get-diff`, `get-changed-files`, and more.
- `ritsu doctor` and `ritsu export` CLI commands.

### Fixed
- TypeScript compilation error in `read-ctx.ts`.
- Ghost plugin references in `marketplace.json`.

## [5.1.0] - 2026-05-15

### Added
- **Compact Context Delivery**: `ritsu_read_ctx` now supports a compact mode to save tokens.
- **Tail-Read Optimization**: High-efficiency context reading for large history files.
- **Decision Rationale**: Mandatory section in `design-sheet` to capture technical trade-offs.
- **Circuit Breaker**: Detection of consecutive failures with automatic redirection to `think` stage.
- Comprehensive unit tests for core handlers.

## [5.0.0] - 2026-05-13

### Added
- Initial release of Ritsu v5 architecture.
- Explicit Staging: `think`, `dev`, `hunt`, `review`. (Note: `test` is merged into `dev`).
- MCP-based toolset.
- `AGENTS.md` project baseline.
