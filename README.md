<div align="center">

# 律 (Ritsu) — AI Delivery Workflow Skill Engine

[![CI](https://github.com/3kaiu/Ritsu/actions/workflows/ci.yml/badge.svg)](https://github.com/3kaiu/Ritsu/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-342_✔-green.svg)](runtime/tests)
[![CodeQL](https://github.com/3kaiu/Ritsu/actions/workflows/codeql.yml/badge.svg)](https://github.com/3kaiu/Ritsu/actions/workflows/codeql.yml)

[核心理念](#-核心理念) • [安装](#-安装) • [指令集](#-指令参考) • [架构](#-架构) • [CLI](#-cli-工具)

</div>

---

## ⚡ 核心理念

Ritsu 是一个 **skill + engine**：对外是 6 个 skill 指令，对内自动编排策略引擎、质量门禁、代码图分析、跨会话记忆。

你只跟这 6 个指令交互，底层一切由 Ritsu 自动完成：

| 指令 | 用途 |
|------|------|
| `/r-think` | 设计 — 产出 design-sheet |
| `/r-dev` | 实现 — 产出 dev-report + quality-gates |
| `/r-review` | 验收 — 产出 assurance-sheet |
| `/r-hunt` | 排障 — 产出 diagnosis |
| `/r-augment` | 补测试 |
| `/r-init` | 初始化项目 |

每个指令对应 `skills/<stage>/SKILL.md`。执行前先调 `ritsu_preflight` 获取上下文。

---

## 📦 安装

Ritsu 不是一个独立 CLI，它是安装在 Claude Code / Codex / Cursor 中的 skill。

```bash
# 1. 安装 skill（一次）
npx skills add 3kaiu/Ritsu -a claude-code -g -y

# 2. 重载 MCP，验证
ritsu doctor

# 3. 开始使用
/r-init
```

或者从插件市场安装：`/plugin install ritsu`

### 本地开发

```bash
cd runtime && bun install && bun run build && bun run test
```

---

## 🧭 架构

```
你看到:   /r-think → /r-dev → /r-review → /r-hunt → /r-augment → /r-init

Ritsu 自动做:
  策略引擎       — 20 条反模式 + 9 个检测器，写入时自动拦截
  质量门禁       — Lint + Test + 工作树指纹
  架构漂移检测   — preflight 时对比模块依赖图
  跨会话记忆     — 违规/偏好自动捕获，向量语义检索
  代码图分析     — CodeGraph 影响半径（如有）
  Token 预算     — ritsu_read_ctx 默认 medium 模式
  AI 配置检查    — ritsu doctor --ai（Claude/Codex/Cursor 三大工具）
```

| 技术栈 | |
|--------|-|
| 运行时 | Bun 1.3+ |
| 测试 | Vitest — 60 文件 / 342 测试 |
| 原生引擎 | Rust napi-rs（向量搜索 + ctx 存储） |
| 策略格式 | YAML + 9 detectors + 用户插件 |
| 存储 | SQLite（Rust WAL）+ JSONL 备份 |
| 支持 AI | Claude Code / Codex CLI / Cursor |

---

## 🎛️ CLI

```bash
ritsu doctor              # 健康检查（最常用）
ritsu doctor --ecosystem  # MCP 生态验证
ritsu doctor --signals    # 结构化审计 (PASS/WARN/FAIL)
ritsu doctor --ai         # AI 工具配置检查
ritsu bootstrap           # 初始化项目
ritsu help                # 全部开发命令
```

---

## 仓库结构

```
├── .claude/           # Claude Code rules/
├── .github/           # CI, Dependabot, CodeQL
├── _shared/           # MCP 工具定义, schemas
├── docs/              # 架构文档
├── rules/             # 策略规则 + ast-grep 模式
├── skills/            # 7 个 SKILL.md（核心）
└── runtime/
    ├── native/        # Rust 引擎 (vector_store + ctx_store)
    ├── src/
    │   ├── cli/       # 9 个 CLI 子模块
    │   ├── handlers/  # 22 个 MCP handlers
    │   ├── orchestration/ # preflight, internal-tools, architecture
    │   └── policy/    # 9 detectors + plugin-loader
    └── tests/         # 60 文件 / 342 测试
```

---

## 许可

MIT © 2024-2026 3kaiu
