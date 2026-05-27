<div align="center">

# Ritsu (律) — AI Code Quality Gate

[![Tests](https://img.shields.io/badge/Tests-509_passing-green.svg)](runtime/tests)
[![npm](https://img.shields.io/npm/v/ritsu-mcp-server)](https://www.npmjs.com/package/ritsu-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Quality gate for AI-generated code.** Ritsu ensures AI coding agents produce correct, secure, and maintainable code — with policy enforcement, session recovery, and audit trails.

**AI 代码质量门禁。** Ritsu 确保 AI 编码代理写出正确、安全、可维护的代码。

[Quick Start](#quick-start) • [Architecture](#architecture) • [CLI](#cli) • [Roadmap](ROADMAP.md)

</div>

---

## Quick Start

```bash
# Install / 安装
npx skills add 3kaiu/Ritsu -a claude-code -g -y

# Check / 检查
ritsu doctor

# Try demo / 体验 demo
ritsu bootstrap --demo
ritsu violations
```

| Command | Stage | 阶段 |
|---------|-------|------|
| `/r-think` | Design | 需求分析 |
| `/r-dev` | Code | 编码实现 |
| `/r-review` | Review | 质量验收 |
| `/r-deploy` | Deploy | 部署门禁 |
| `/r-hunt` | Debug | 智能排障 |
| `/r-augment` | Tests | 补测引擎 |

## Architecture

```
skills/             8 SKILL.md instruction files
rules/              20 anti-patterns + ast-grep guardrails
runtime/src/
  handlers/         24 MCP tool handlers
  policy/           11 detectors + blast radius + import graph
  orchestration/    preflight, multi-agent, contract verification
  cli/              doctor, report, violations
```

**11 detectors / 11 个检测器**: ScopeDiff, SecuritySmell, ContractDrift, Architecture, AstGrep, Regex, CrossFile, CodeGraph, PreferenceLint, ContractCoverage

**Session recovery / 会话恢复**: Auto-checkpoint at every step. Crash? New session picks up exactly where you left off.

**Multi-agent / 多 Agent**: Split design contracts across parallel agents, cross-review, detect conflicts.

**Contract verification / 契约验证**: Three-level pipeline — file exists → test references contract → code paths actually exercised.

## CLI

```bash
ritsu doctor            # Health check / 健康检查
ritsu report            # Agent analytics / 行为分析
ritsu report --cost     # Token cost / 成本追踪
ritsu violations        # Open violations / 未解决违规
ritsu violations --trend # Monthly trend / 月度趋势
ritsu trace <id>        # Trace tree / 追踪链路
ritsu verify <id>       # HMAC verification / 签名验证
```

## Comparison / 对比

| Capability | Bare AI Agent | Ritsu |
|-----------|--------------|-------|
| Policy enforcement | None | 11 detectors |
| Session recovery | None | Auto-checkpoint |
| Design contracts | None | Sheet → Report → Assurance |
| Cost tracking | None | Per-model breakdown |
| Multi-agent | None | Parallel dispatch + review |

## License

MIT © 2024-2026 3kaiu

[Changelog](CHANGELOG.md) • [Contributing](CONTRIBUTING.md) • [Roadmap](ROADMAP.md)
