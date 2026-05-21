# Ritsu 开源生态集成指南 v7.0

> local-first · compose 不内嵌 · Claude Code 为标准主机

## 0. 自动 vs 手动

| 能力 | 自动 | 仍需手动 |
|------|------|---------|
| **Claude Code MCP** | `ritsu bootstrap` → `.mcp.json` | 重载 MCP（重启或 `/mcp`） |
| **Superpowers** 检测 | `preflight-runner` 自动路由 | — |
| **CodeGraph** 注册 | `ritsu bootstrap` 写入 `.mcp.json` | 首次需 `npm install -g codegraph` |
| **OpenSpec** | `ritsu_preflight(stage=think)` | 首次需网络 `npx` |
| **开发/Review 预检** | `ritsu_preflight` 共享 policy 缓存 | 修复 violation 后重跑 |
| **ast-grep AP-13** | policy 经 preflight/gates | 首次 `npx @ast-grep/cli` |
| **Cursor**（可选） | `ritsu bootstrap --host all` | 重启 Cursor |

## 1. MCP 组合（bootstrap 默认）

| MCP Server | 用途 |
|-----------|------|
| `ritsu` | 证据链、policy、artifacts、trace |
| `@modelcontextprotocol/server-filesystem` | 定向读文件 |
| `@modelcontextprotocol/server-git` | git 上下文 |
| `@modelcontextprotocol/server-github` | PR/Issue（需 token） |
| `codegraph`（可选） | 代码图查询 |

## 2. 外部集成

| 项目 | 集成点 | 文件 |
|------|--------|------|
| Superpowers | 自动检测 → 阶段映射 → Ritsu 治理 | `orchestration/superpowers-bridge.ts` |
| CodeGraph | `codegraph` DetectorType + Preflight 上下文 | `policy/detectors/codegraph.ts` |
| OpenSpec | `/opsx:` 命令 + contract 提取 | `openspec-bridge.ts` |
| Waza | 反模式 examples + Gotchas 表 + --signals | `rules/anti-patterns.yaml` |
| Claude-Mem | 3 层渐进式记忆 + auto-capture | `session-memory.ts` |
| ast-grep | AP-13, `rules/ast-grep/` | `policy/detectors/ast-grep.ts` |
| Context7 | `.ritsu/ecosystem.json` 说明 | 需 API key |

## 3. 静态分析

| 工具 | 集成点 |
|------|--------|
| ts-morph | policy AST detector |
| ast-grep | AP-13, `rules/ast-grep/` |
| CodeGraph | codegraph detector |

## 4. Cursor 用户

```bash
ritsu bootstrap --host all
# 可选 hooks：
ritsu bootstrap --host all --include-cursor-hooks
```

重启 Cursor 后 `ritsu doctor --ecosystem`。

## 5. 多 Agent

Ritsu: trace、lease、task coordination（主机无关）
Superpowers subagent-driven-development: 通过 `preflight-runner` 路由到 Ritsu 治理
