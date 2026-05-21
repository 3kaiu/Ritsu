# Ritsu 集成指南 v7.0

> 所有底层工具由 `ritsu bootstrap` 自动配置，preflight 自动调用，对用户透明。

## 自动配置的底层 MCP

`ritsu bootstrap` 在 `.mcp.json` 中注册以下 MCP 服务器，全部由 Ritsu 内部调用：

| MCP Server | Ritsu 内部用途 |
|-----------|--------------|
| `ritsu` | 策略引擎、ctx 追踪、artifact 管理 |
| `filesystem` | preflight 时定向读文件 |
| `git` | preflight 时 diff inspect |
| `github` | review 时 PR/Issue 访问 |
| `codegraph` | preflight 时代码图分析 |
| `context7` | 自动注入最新文档 |
| `playwright` | quality-gates 的 E2E 测试 |

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
