# Ritsu — AI Delivery Workflow Skill

Ritsu is a **skill** for Claude Code / Codex / Cursor. It governs your AI delivery workflow through 6 skill commands. It doesn't replace your AI tool — it runs inside it.

## Install

```bash
npx skills add 3kaiu/Ritsu -a claude-code -g -y
# or: /plugin install ritsu
```

After install, reload MCP and run `ritsu doctor`.

## Your Skills

| 执行 | 指令 | 产出 |
|------|------|------|
| Think | `/r-think` | design-sheet |
| Dev | `/r-dev` | dev-report + quality-gates |
| Review | `/r-review` | assurance-sheet |
| Hunt | `/r-hunt` | diagnosis |
| Augment | `/r-augment` | 提升测试覆盖 |
| Init | `/r-init` | AGENTS.md + .ritsu/ |

Each skill = `skills/<stage>/SKILL.md` — read it before executing.

## How Ritsu Helps You

- **preflight**: 进入技能前自动加载上下文、检查策略、检测架构漂移
- **policy**: 写入时自动拦截反模式 (AP-1 ~ AP-13, 20条规则)
- **gates**: 完成时自动运行 lint + test + 指纹校验
- **memory**: 下一 session 自动恢复上次未完成的任务
- **learning**: 从你的修正中学习偏好，下次自动遵守

## Rules

`rules/anti-patterns.yaml` — 全部 20 条。关键的：

- **AP-5**: 没有命令输出就不要说"通过了"
- **AP-6**: 不准留 TODO/TBD
- **AP-7**: 报错了就停下来分析
- **AP-9**: 产出不留 AI 痕迹
- **AP-13**: 交付前扫 debugger/console.log

## 架构参考

- `skills/<stage>/SKILL.md` — 技能详细指令 + Gotchas
- `runtime/src/` — 源码 (60 测试文件 / 342 测试)
- `runtime/native/` — Rust 引擎 (向量搜索 + ctx 存储)
- `_shared/mcp-tools.yaml` — 22 个 MCP 工具
- `rules/anti-patterns.yaml` — 策略规则 + WRONG/RIGHT 示例
