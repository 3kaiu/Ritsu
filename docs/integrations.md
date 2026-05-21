# Ritsu 开源生态集成指南 v6.1.0

> local-first · compose 不内嵌 · Claude Code 为标准主机

## 0. 自动 vs 手动（一览）

| 能力 | 自动 | 仍需一次/偶尔手动 |
| --- | --- | --- |
| **Claude Code MCP**（ritsu + filesystem + git） | `/r-init` → `ritsu_bootstrap_ecosystem` 或 `ritsu bootstrap` | **重载 MCP**（重启会话或 Claude `/mcp`） |
| OpenSpec P2 设计 | `ritsu_preflight(stage=think)` | 首次需网络 `npx` |
| 开发/Review 预检 | `ritsu_preflight` + `run_quality_gates`（共享 policy 缓存） | 修复 violation 后重跑 |
| 排障上下文 | `ritsu_preflight(stage=hunt)` | — |
| ast-grep AP-13 | policy 经 preflight/gates | 首次 `npx @ast-grep/cli` |
| Context7 | `.ritsu/ecosystem.json` 说明 | API key + 手动加入 `.mcp.json` |
| **Cursor**（可选） | `ritsu bootstrap --host all` | 重启 Cursor |

**推荐首次流程**：`/r-init` → 重载 **Claude Code** MCP → `ritsu doctor --ecosystem` → `/r-think`。

---

## 1. 一键入口

| 工具 / CLI | 作用 |
| --- | --- |
| `ritsu_bootstrap_ecosystem` | 写入 `.mcp.json`、`.ritsu/ecosystem.json`（默认 Claude） |
| `ritsu bootstrap [--host claude-code\|cursor\|all]` | 同上 |
| `ritsu doctor --ecosystem` | 以 `.mcp.json` 为准校验生态 |
| `ritsu_preflight` | 阶段 `context_pack`（唯一编排入口） |
| `ritsu_inspect_diff` | diff stat / chunks / full |

---

## 2. 推荐 MCP 组合（bootstrap 默认）

| MCP Server | 用途 |
| --- | --- |
| `ritsu` | 证据链、policy、artifacts、trace |
| `@modelcontextprotocol/server-filesystem` | 定向读文件 |
| `@modelcontextprotocol/server-git` | git 上下文 |
| `@modelcontextprotocol/server-github` | PR/Issue（需 token） |

Claude Desktop： [mcp-claude-desktop.example.json](./mcp-claude-desktop.example.json)（主模板）。

---

## 3. 最小充分上下文包

**只调用 `ritsu_preflight`**，勿手工重复：

1. `read_ctx`（preflight 内）
2. `inspect_diff` chunks/full（dev/review/hunt）
3. doc MCP（仅第三方库）
4. 定向读文件 — 禁止无 index 全库扫描

---

## 4. OpenSpec（SDD）

见 [_shared/openspec-contract-bridge.md](../_shared/openspec-contract-bridge.md)。P2 think 由 preflight 自动 init/propose/sync。

---

## 5. 静态分析

| 工具 | 集成点 |
| --- | --- |
| ts-morph | policy AST |
| ast-grep | AP-13，`rules/ast-grep/` |
| Semgrep | review 可选 `ritsu_exec` |

---

## 6. 多 Agent

- Ritsu：trace、lease、task claim（主机无关）

---

## 附录 B · Cursor 用户

```bash
ritsu bootstrap --host all
# 可选 hooks：
ritsu bootstrap --host all --include-cursor-hooks
```

重启 Cursor 后 `ritsu doctor --ecosystem`（`.cursor/mcp.json` 为 warn 级可选项）。
