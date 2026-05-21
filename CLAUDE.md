# Ritsu — AI Delivery Skill Engine

Ritsu is **two things**:

1. **A skill** — 你给我 6 个指令 (`/r-think`, `/r-dev`, `/r-review`, `/r-hunt`, `/r-augment`, `/r-init`)，我引导你完成完整的交付流程
2. **An engine** — 你只需要跟我交互，底层我自动编排其他 skill、MCP 工具、协议、插件

## 你不用关心底层

Ritsu 自动帮你处理以下所有事情，你不需要直接调用它们：

| Ritsu 自动做 | 底层能力 |
|-------------|---------|
| 进入 think 前拉取设计上下文 | Superpowers brainstorming (如有) |
| preflight 时分析代码影响 | CodeGraph 代码图 |
| 设计阶段自动同步规格 | OpenSpec 协议 |
| 写入 artifact 时拦截违规 | 9 个策略检测器 + 用户插件 |
| diff 时检测架构漂移 | architecture-analyzer 模块 |
| 完成时质量门禁 | lint + test + 工作树指纹 |
| 跨会话记忆 | 向量引擎存储 + 语义检索 |
| 从你的修正中学习 | 偏好挖掘 + 自动规则合成 |

## 你的接口

你只通过 6 个指令与 Ritsu 交互。每个指令对应 `skills/<stage>/SKILL.md`。

| 执行 | 指令 | 读这个文件 |
|------|------|-----------|
| Think | `/r-think` | `skills/think/SKILL.md` |
| Dev | `/r-dev` | `skills/dev/SKILL.md` |
| Review | `/r-review` | `skills/review/SKILL.md` |
| Hunt | `/r-hunt` | `skills/hunt/SKILL.md` |
| Augment | `/r-augment` | `skills/augment/SKILL.md` |
| Init | `/r-init` | `skills/init/SKILL.md` |

执行前先调 `ritsu_preflight` 获取 `_ai_summary`——读一行就知道当前状态和下一步。

## Install

```bash
npx skills add 3kaiu/Ritsu -a claude-code -g -y
```

之后重载 MCP，运行 `ritsu doctor` 确认。

## 你必须遵守

`rules/anti-patterns.yaml` 定义 20 条底线：

- **AP-5**: 没有命令输出就不要说"通过了"
- **AP-6**: 不准留 TODO/TBD
- **AP-7**: 报错了就停下来分析
- **AP-9**: 产出不留 AI 痕迹
- **AP-13**: 交付前扫 debugger/console.log

## 架构参考

- `skills/<stage>/SKILL.md` — 技能指令 + Gotchas
- `runtime/src/orchestration/` — 引擎编排层 (preflight, internal tools, architecture)
- `runtime/src/handlers/` — 22 个 MCP 工具
- `runtime/src/policy/` — 策略引擎 + 9 个检测器
- `runtime/native/` — Rust 原生引擎 (向量搜索 + ctx 存储)
- `_shared/mcp-tools.yaml` — 全部 MCP 工具定义
