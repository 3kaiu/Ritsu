<div align="center">

# Ritsu (律)

**AI agents write code. Ritsu checks it.**

[![Tests](https://img.shields.io/badge/Tests-592_passing-green.svg)](runtime/tests)
[![npm](https://img.shields.io/npm/v/ritsu-mcp-server)](https://www.npmjs.com/package/ritsu-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

When Claude Code or Cursor generates code, Ritsu catches what the agent misses — scope creep, security vulnerabilities, broken contracts, architecture drift, credential leaks. With session recovery, multi-agent orchestration, and visual UI checks.

AI 写代码，Ritsu 管质量。

[Quick Start](#quick-start) • [Why](#why) • [Install](https://www.npmjs.com/package/ritsu-mcp-server)

</div>

---

## Quick Start

```bash
# Try it now — no project needed
npx skills add 3kaiu/Ritsu -a claude-code -g -y
ritsu bootstrap --demo
ritsu violations --open
```

| Command | What it does |
|---------|-------------|
| `/r-think` | Analyze + design contracts |
| `/r-dev` | Code with policy enforcement |
| `/r-review` | Quality + security review |
| `/r-deploy` | Deploy plan + rollback |
| `/r-hunt` | Root cause diagnosis |
| `/r-augment` | Test gap analysis |

---

## Why

AI coding agents have three blind spots:

- **No quality awareness** — they don't check for security issues, architecture drift, or contract compliance
- **No memory** — when a session ends, everything resets
- **No audit trail** — no record of what was checked or what it cost

Ritsu is a **governance layer** that runs alongside AI agents, continuously checking, recording, and recovering.

**What it catches**: scope creep, XSS/SQL injection, hardcoded credentials, broken API contracts, circular dependencies, console.log/debugger left in production, version mismatches, unauthorized file changes.

---

## Architecture

```
Agent writes code → Policy engine (12 detectors / 21 anti-patterns) → Quality gates → Violation tracked
                  → Session checkpoint → Contract verified → Visual check
```

## CLI / 命令行

```bash
ritsu doctor            # Health / 健康检查
ritsu report            # Quality analytics / 质量分析
ritsu report --cost     # Cost breakdown / 成本追踪
ritsu violations        # Open issues / 未解决违规
ritsu trace <id>        # Trace tree / 追踪链路
ritsu violations --trend # Monthly trend / 月度趋势
```

---

## License

MIT © 2024-2026 3kaiu

[Changelog](CHANGELOG.md) • [Contributing](CONTRIBUTING.md) • [Roadmap](ROADMAP.md)
