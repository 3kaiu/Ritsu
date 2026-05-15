# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.2.0] - 2026-05-15 (Proposed)

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
