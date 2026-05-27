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
