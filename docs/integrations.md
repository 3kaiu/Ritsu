# Ritsu 集成指南 v7.0

## 安装

```bash
# Claude Code
npx skills add 3kaiu/Ritsu -a claude-code -g -y

# 或插件市场
/plugin install ritsu
```

安装后重载 MCP，运行 `ritsu doctor` 确认。

## 自动配置

Ritsu 在 `.mcp.json` 中只注册自身：

| MCP Server | 用途 |
|-----------|------|
| `ritsu` | 策略引擎、ctx 追踪、artifact 管理、diff inspect |

其他工具（CodeGraph、Superpowers 等）由 `orchestration/internal-tools.ts` 通过 CLI 直接调用，对用户透明。

## 用户流程

```bash
# 日常使用 — 6 个指令
/r-init     # 初始化项目
/r-think    # 设计
/r-dev      # 实现
/r-review   # 验收
/r-hunt     # 排障
/r-augment  # 补测试
```

## AI 工具兼容

| 工具 | 配置文件 | 状态 |
|------|---------|------|
| Claude Code | `CLAUDE.md` | ✅ 自动读取 |
| Codex CLI | `CODEX.md` | ✅ 自动读取 |
| Cursor | `.cursor/rules/ritsu.mdc` | ✅ 自动触发 |

运行 `ritsu doctor --ai` 检查所有配置完整性。
