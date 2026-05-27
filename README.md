<div align="center">

# Ritsu (律) — AI Code Quality Gate

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-479_passing-green.svg)](runtime/tests)
[![Runtime](https://img.shields.io/badge/Runtime-Bun_1.3+-blue.svg)](https://bun.sh)
[![Coverage](https://img.shields.io/badge/Coverage-85.7%25_lines-ok.svg)]()
[![npm](https://img.shields.io/npm/v/ritsu-mcp-server)](https://www.npmjs.com/package/ritsu-mcp-server)
[![Claude Code](https://img.shields.io/badge/Claude_Code-ready-purple)]()
[![Cursor](https://img.shields.io/badge/Cursor-ready-blue)]()

**Quality gate for AI-generated code.** Ritsu ensures AI coding agents produce correct, secure, and maintainable code — with policy enforcement, session recovery, and audit trails.

[Getting Started](#-quick-start) • [Core Features](#-core-features) • [Architecture](#-architecture) • [CLI](#%EF%B8%8F-cli-tools) • [Roadmap](ROADMAP.md)

</div>

---

## Why Ritsu?

AI coding agents (Claude Code, Codex, Cursor) are transforming software development, but they have three critical blind spots:

- **No quality awareness** — AI won't self-check for security issues, architecture drift, or broken contracts
- **No memory** — When a session ends, everything resets. New sessions start from zero.
- **No audit trail** — No way to answer "what checks did this change pass? How much did it cost?"

Ritsu fills these gaps. It's not an AI agent — it's a **governance layer** that runs alongside agents, continuously checking, recording, and recovering.

```
Agent writes code → Ritsu policy engine checks → Quality gates pass/fail → Checkpoint saved
                     ↑                              ↓
                  11 detectors                   pass/fail + evidence
```

---

## Quick Start

```bash
# 1. Install
npx skills add 3kaiu/Ritsu -a claude-code -g -y

# 2. Check environment
ritsu doctor

# 3. Try demo mode (no project needed)
ritsu bootstrap --demo
ritsu violations
ritsu report

# 4. Or initialize a real project in Claude Code
/r-init
```

Then use slash commands to drive the full delivery pipeline: <br>
*(Also works in Cursor and Codex CLI — see [Compatibility](#-compatibility))*

| Command | Stage | What you get |
|---------|-------|-------------|
| `/r-think` | Design | Architecture analysis, contract docs, risk assessment |
| `/r-dev` | Code | Policy-enforced implementation with quality gates |
| `/r-review` | Review | Assurance sheet: mergeability + deployability verdict |
| `/r-deploy` | Deploy | Rollback plan, canary strategy, post-deploy validation |
| `/r-hunt` | Debug | Evidence-chain diagnosis with root cause analysis |
| `/r-augment` | Tests | Coverage gap analysis + targeted test generation |

---

## Core Features

### Quality Gate — Policy Engine

11 built-in detectors that catch what AI agents miss:

| Detector | What it catches |
|----------|----------------|
| ScopeDiff | Agent went beyond the agreed scope (AP-4) |
| SecuritySmell | eval, XSS, command injection, SQL injection (R-6) |
| ContractDrift | Breaking API/component interface changes (R-4) |
| Architecture | Cross-module dependency violations, circular deps (R-8) |
| AstGrep | debugger, console.log, empty catch blocks left behind |
| Regex | Placeholder promises, credential leaks, SQL DROP |
| CrossFile | Version number mismatches across package.json files |
| CodeGraph | Exported symbols without test coverage |
| PreferenceLint | Project-specific coding style violations |
| ContractCoverage | Design contracts missing corresponding test assertions |

Pass rates are enforced with **adaptive thresholds** — core modules (auth, payment, crypto) require 100% line coverage; periphery passes on compilation.

### Session Recovery — Checkpoint & Resume

AI agent session crashed? Terminal closed? Network dropped?

Ritsu auto-saves a structured checkpoint at every step completion, artifact write, and task boundary. On next session start, it injects a recovery prompt so the new agent knows exactly:

```
📋 Session Recovery (hot)
Skill: dev | Step 3/5
Done: created Order model, implemented CRUD routes
Pending: add tests, quality gates, deliver
Active violations: none
Working files: models/order.ts, routes/order.ts
```

No more "I was halfway through a task and now I have to explain everything again."

### Test Quality Intelligence

Coverage % is a misleading metric. Ritsu analyzes test quality beyond the percentage:

- **Assertion density**: tests with no assertions are just smoke tests
- **Snapshot-only detection**: toMatchSnapshot without explicit assertions
- **Mock gap analysis**: external dependencies left unmocked
- **Contract coverage map**: design contracts to test file mappings

### Analytics & Cost Tracking

```bash
ritsu report           # Quality trends, pass rates, violation rankings
ritsu report --cost    # Token cost breakdown by model
ritsu report --trend   # Monthly quality trajectory
```

Data all comes from existing ctx events — no extra instrumentation needed.

### Multi-Agent Coordination

File leases, task claims, agent status queries, and HMAC-signed audit trails. Multiple AI agents can work on the same project without stepping on each other.

### Cross-Session Learning

Ritsu learns from human corrections during review. Patterns are mined, synthesized into preference rules, and automatically enforced in future sessions. Five heuristic patterns + optional LLM synthesis.

---

## Architecture

```
                          ┌──────────────────────────┐
                          │   Skills Layer (8 .md)   │
                          │  think dev review hunt   │
                          │  deploy augment freestyle│
                          └────────────┬─────────────┘
                                       │
                          ┌────────────▼─────────────┐
                          │   Orchestration Layer    │
                          │  preflight → policy → QA │
                          └────────────┬─────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
   ┌──────────▼──────────┐  ┌─────────▼─────────┐  ┌──────────▼──────────┐
   │  Policy Engine      │  │  Quality Gates    │  │  Context Lifecycle  │
   │  11 detectors       │  │  adaptive coverage │  │  checkpoints        │
   │  blast radius BFS   │  │  test intelligence│  │  recovery prompts   │
   │  import graph       │  │  triple-check     │  │  token budget       │
   └─────────────────────┘  └───────────────────┘  └─────────────────────┘
                                       │
                          ┌────────────▼─────────────┐
                          │   Storage Layer          │
                          │  SQLite WAL + JSONL      │
                          │  + Vector Embeddings     │
                          └──────────────────────────┘
```

### Key directories

```
├── skills/              # 8 stage instructions (SKILL.md)
├── rules/               # 20 anti-patterns + ast-grep + guardrails
├── _shared/             # MCP tool schemas + JSON Schema + protocols
├── runtime/src/
│   ├── handlers/        # 24 MCP tool handlers
│   ├── policy/          # 11 detectors + blast radius + import graph
│   ├── orchestration/   # preflight, diff-inspect, architecture analysis
│   └── cli/             # doctor, bootstrap, export, mine, report
└── runtime/tests/       # 70 test files, 479+ passing
```

---

## CLI Tools

```bash
ritsu doctor            # Health check
ritsu doctor --signals  # Structured PASS/FAIL audit
ritsu report            # Agent behavior analytics
ritsu report --cost     # Token cost breakdown
ritsu mine --auto       # Preference learning from corrections
ritsu trace <id>        # Trace + span tree visualization
ritsu verify <id>       # HMAC signature verification
```

---

## Compatibility

| Platform | Support |
|----------|---------|
| Claude Code | ✅ Full — `.claude/rules/` auto-load, real-time IDE sync |
| Cursor | ✅ Full — `.cursor/rules` with Mermaid arch diagrams |
| Codex CLI | ✅ `CODEX.md` workflow support |
| Cline / Copilot | 🔄 MCP-compatible (roadmap) |

---

## Comparison

| Capability | Bare Claude Code | Ritsu |
|------------|-----------------|-------|
| Policy enforcement | None | 11 detectors + 20 anti-patterns |
| Session recovery | None | Auto-checkpoint + recovery prompt |
| Test quality analysis | None | Assertion density + contract coverage |
| Cost tracking | None | Per-model breakdown with trends |
| Cross-session memory | None | SQLite + vector embeddings |
| Audit trail | None | HMAC-signed event chain |
| Design contracts | None | Structured design-sheet → dev-report → assurance-sheet |
| Multi-agent coordination | None | File leases + task claims + agent status |

---

## License

MIT © 2024-2026 3kaiu

---

[Roadmap](ROADMAP.md) — [Changelog](CHANGELOG.md) — [Contributing](CONTRIBUTING.md) — [Security](SECURITY.md)
