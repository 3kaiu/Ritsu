# Ritsu 集成指南 v7.0

> 所有底层工具由 `ritsu bootstrap` 自动配置，preflight 自动调用，对用户透明。

## 自动配置

`ritsu bootstrap` 只在 `.mcp.json` 中注册 Ritsu 自身：

| MCP Server | 用途 |
|-----------|------|
| `ritsu` | Ritsu 核心引擎 — 策略引擎、ctx 追踪、artifact 管理、diff inspect |

其他工具（CodeGraph、OpenSpec 等）由 `internal-tools.ts` 通过 CLI 直接调用，不需要 MCP 通道。

## 用户流程

```bash
# 首次设置
cd runtime && bun install && bun run build
ritsu bootstrap              # 自动配置全部 MCP
ritsu doctor                  # 校验一切就绪

# 日常使用 — 只通过 4 个指令
/r-think    # 设计
/r-dev      # 实现
/r-review   # 验收
/r-hunt     # 排障
```

## Cursor 用户

```bash
ritsu bootstrap --host all
ritsu doctor --ecosystem
```
