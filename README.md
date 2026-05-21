<div align="center">

# 律 (Ritsu) — AI 交付工作流引擎
**Deterministic AI Engineering Lifecycle for High-Stakes Production Delivery**

[![CI/CD](https://github.com/3kaiu/Ritsu/actions/workflows/ci.yml/badge.svg)](https://github.com/3kaiu/Ritsu/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-7.0.0-blue.svg)](CLAUDE.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-344_✔-green.svg)](runtime/tests)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.3.0-black.svg)](runtime/package.json)

[快速开始](#-快速开始) • [核心理念](#-核心理念) • [架构](#-架构) • [指令集](#-指令参考) • [CLI](#-cli-工具) • [配置](#-配置)

</div>

---

## ⚡ 核心理念

Ritsu 将 AI 的工作流约束于**阶段契约**中。你只通过 4 个指令与 Ritsu 交互：
`/r-think` → `/r-dev` → `/r-review` → `/r-hunt`。底层的一切（策略引擎、质量门禁、
代码图分析、文档注入、跨会话记忆）由 Ritsu 自动完成，对你完全透明。

- **策略引擎** — 13 条反模式 + 8 个检测器，写入时和交付前自动拦截
- **质量门禁** — Lint + Test + Worktree 指纹 + 验证声明检查
- **跨会话记忆** — 自动捕获违规/偏好，向量引擎语义检索
- **多 MCP 自动配置** — bootstrap 时自动注册文件系统/Git/GitHub/CodeGraph/Context7/Playwright
- **Token 预算控制** — `ritsu_read_ctx` 支持 `token_budget` 参数动态裁剪

---

## 🧭 架构

```
Skills (Markdown 协议)   →  7 个 SKILL.md（用户看到的唯一界面）
Orchestration            →  preflight-runner, internal-tools, diff-inspect
MCP Handlers             →  22 个合并工具（对用户透明）
Policy Engine            →  plugin-loader + 8 detectors (含 codegraph)
Storage                  →  JSONL + SQLite 双写, 向量记忆
Native Engine            →  Rust napi-rs: 余弦相似度搜索
CLI                      →  doctor, cat, trace, export, sync, mine, bootstrap
```

| 技术栈 |  |
|--------|---------|
| 运行时 | Bun 1.3+ (已迁移, 移除 npm) |
| 测试 | Vitest — 60 文件, 344 测试, 全覆盖 |
| 原生插件 | Rust napi-rs, 可选 (纯 JS 回退) |
| 策略格式 | YAML (anti-patterns.yaml) + 用户插件 |
| 存储 | JSONL + SQLite (bun:sqlite) |
| 向量搜索 | Rust 引擎 (sqlite-vec 余弦相似度) |

详细架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## 🛠️ 快速开始

```bash
# 1. 安装依赖
cd runtime && bun install

# 2. 构建
bun run build

# 3. 运行测试
bun run test

# 4. CLI 健康检查
bun dist/cli.js doctor

# 5. 引导 Ritsu 生态 (生成 .mcp.json)
ritsu bootstrap

# 6. 在项目中初始化
/r-init
```

---

## 🧭 指令参考

| 指令 | 角色 | 产出 |
|------|------|------|
| `/r-think` | 架构师 | design-sheet, contracts |
| `/r-dev` | 开发者 | dev-report, quality-gates |
| `/r-review` | 审计师 | assurance-sheet |
| `/r-hunt` | 诊断专家 | diagnosis |
| `/r-augment` | QA | 补测试, coverage 提升 |
| `/r-init` | 初始化 | AGENTS.md, .ritsu/ |

---

## 🎛️ CLI 工具

```bash
bun dist/cli.js doctor              # 项目健康检查
bun dist/cli.js doctor --health     # 4 维健康度指标
bun dist/cli.js doctor --signals    # Waza 风格审计信号 (PASS/WARN/FAIL)
bun dist/cli.js doctor --ecosystem  # MCP 生态检查
bun dist/cli.js cat --recent 10     # 最近 10 条事件
bun dist/cli.js trace <id>          # Trace 链路
bun dist/cli.js export --out REPORT.md
bun dist/cli.js mine --report       # 偏好挖掘
bun dist/cli.js sync push/pull      # Git 同步
```

---

## ⚙️ 配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `RITSU_PROJECT_ROOT` | `process.cwd()` | 项目根目录 |
| `RITSU_LLM_ENABLED` | `0` | 启用 LLM 驱动规则合成 |
| `RITSU_LLM_API_KEY` | `""` | LLM API 密钥 |
| `RITSU_LLM_ENDPOINT` | `https://api.openai.com/v1` | LLM API 端点 |
| `RITSU_STRICT_OUTPUT` | `warn` | 输出严格模式 |

项目基线配置见 `AGENTS.md`，CLI 配置见 `CLAUDE.md`。

---

## 仓库结构

```
├── .claude/              # Claude Code 配置 (rules/, ignore)
├── _shared/              # 协议规范 (mcp-tools.yaml, schemas)
├── docs/                 # 架构文档
├── domains/              # 领域配置 (frontend/backend/fullstack)
├── rules/                # 策略规则 (anti-patterns.yaml, ast-grep/)
├── skills/               # 阶段剧本 (7 个 SKILL.md)
└── runtime/              # 运行时内核
    ├── src/              # 源码 (~13,000 TS, 204 Rust)
    │   ├── cli/          # CLI 命令 (9 个子模块)
    │   ├── handlers/     # 22 个 MCP handlers
    │   ├── policy/       # 策略引擎 + 8 detectors
    │   ├── orchestration/# 编排层
    │   └── native/       # Rust napi-rs 插件
    └── tests/            # 60 文件, 344 测试
```

---

## 许可

MIT © 2024-2026 3kaiu & Antigravity AI Engineering Framework
