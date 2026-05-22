<div align="center">

# 律 (Ritsu) — AI Delivery Workflow Skill Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-345_✔-green.svg)](runtime/tests)
[![Runtime](https://img.shields.io/badge/Runtime-Bun_1.3+-blue.svg)](https://bun.sh)
[![Tech Stack](https://img.shields.io/badge/Tech_Stack-TypeScript-blue.svg)](https://www.typescriptlang.org)

**极速、轻量、高精度的 AI 自动化交付与架构防腐工作流引擎**

[核心理念](#-核心理念) • [核心特性](#-核心特性) • [安装与使用](#-安装与使用) • [架构设计](#-架构设计) • [CLI 诊断工具](#-cli-诊断工具) • [兼容性](#-兼容性)

</div>

---

## ⚡ 核心理念

Ritsu 是一个面向现代 AI 编码助手（如 Claude Code, Codex, Cursor 等）的 **工作流指令与策略执行引擎 (Skill + Engine)**。

通过向 AI 暴露 6 个极其内聚的阶段指令，Ritsu 在底层自动为 AI 编排**策略引擎、质量门禁、架构依赖图、跨会话记忆与 Token 预算**，确保大型代码库在 AI 频繁修改下依然保持 100% 的设计契约与架构健康。

### Ritsu 交付指令集 (Ritsu Skills)

| 指令 | 对应技能 | 阶段核心交付物 |
| :--- | :--- | :--- |
| **`/r-init`** | 契约初始化 | 建立项目开发契约底座，生成 `AGENTS.md` 规则基线 |
| **`/r-think`** | 架构设计 | 深度剖析设计方案，产出设计蓝图 `design-sheet.md` |
| **`/r-dev`** | 代码实现 | 执行编码，自动运行本地质量门禁并生成开发日志 |
| **`/r-review`** | 质量验收 | 全量契约及架构漂移审计，生成正式 `assurance-sheet` |
| **`/r-hunt`** | 智能排障 | 深度追踪 Trace 链路，提取环境及错误上下文进行诊断 |
| **`/r-augment`** | 补测引擎 | 自动分析覆盖率缺口，智能补全核心业务单元测试 |

---

## 🚀 核心特性

### 1. ⚡ Prompt Caching (提示词缓存) 协议支持
完美对齐 Anthropic Claude-3.7 和 DeepSeek-V3/R1 的提示词缓存规则。通过在会话极前端锁定静态的 `rules/anti-patterns.yaml`（底线规则）和 `_shared/mcp-tools.yaml`（工具定义），将动态的 Git Diffs 和 JIT 上下文后置，实现 **80% 的延迟缩短**与 **90% 的 Token 成本节省**。

### 2. 🪶 JIT (Just-In-Time) 上下文加载与自动熔断
摒弃一次性加载数万 Token 的传统 Eager 加载模式。Ritsu Preflight 默认以 **JIT 模式 (`detail: false`)** 运行，仅返回极轻量的元数据索引。
* **自适应熔断 (Self-Healing)**：当检测到 Trace 链路中连续发生 2 次以上失败（`consecutive_fails >= 2`）时，自动升级为 Eager 完整加载模式，确保 AI 拥有充足的调试指引。

### 3. 💾 纯 Bun 驱动的 0 编译轻量双轨存储
彻底移除 Rust `napi-rs` 编译依赖，解决跨平台安装报错。Ritsu 采用高性能纯 JS 实现：
* **内存缓存层 (`:memory:`)**：由 Bun 内置的 `bun:sqlite` 提供极致的内存级 SQL 查询与索引，单次 pre-warm 预热小于 **5ms**。
* **磁盘持久化层 (`.jsonl`)**：写操作直达磁盘追加日志文件，读操作优先命中内存。100% 免疫多实例并行测试下的文件锁定和 `SQLITE_IOERR` 磁盘冲突。

### 4. 🔍 Jaccard 字面粗筛 + Cosine 向量回退混合检索
在违规相似度匹配中，Ritsu 引入了混合检索机制：
* 优先使用基于分词的 **Jaccard 相似度算法**，在 JS 侧进行高速字面粗筛。
* 若历史记录缺失分词上下文，无缝退避至基于字符 n-gram 哈希特征的 **Cosine 相似度计算**，保障 100% 向上兼容。

### 5. 🛠️ 稳健的 Git 分隔符解析器
重构了 `miner.ts` 中的 Git 日志解析流程。在 `git log` 中注入 `<RITSU_COMMIT_START>` 结构化分隔符，并采用 `\r?\n(?=diff --git )` 断言拆分，完全免疫用户提交内容中的关键字冲突，健壮支持各种包含空格、特殊引号的复杂文件名。

### 6. 🚦 标准化质量门禁 JSON 适配器
Ritsu 质量门禁（Quality Gates）原生集成 `VitestJsonTestAdapter` 和 `JestJsonTestAdapter`。自动向包管理器（`bun`, `npm`, `pnpm`）注入结构化测试输出参数，直接读取 JSON 报告数据，彻底防止由于控制台彩色 stdout 变动导致的解析瘫痪。

---

## 📦 安装与使用

Ritsu 作为一个工作流 Skill 挂载在主流 AI 助手上。

### 1. 全局安装 Skill
```bash
# 从 GitHub 仓库一次性添加 Skill 到你的 Claude Code / Codex
npx skills add 3kaiu/Ritsu -a claude-code -g -y
```

### 2. 启动诊断与验证
```bash
# 检查 Ritsu 运行环境、基线配置与 AI 兼容性
ritsu doctor
```

### 3. 在项目根目录初始化
```bash
# AI 助手中运行此指令
/r-init
```

---

## 🧭 架构设计

Ritsu 采用高内聚、低耦合的**五层架构**设计：

```
┌─────────────────────────────────────────────────────────┐
│              Skills Layer (7 个 SKILL.md 指令)           │
└────────────────────────────┬────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────┐
│            Orchestration Layer (调度控制中心)             │
│    - preflight-runner.ts       - architecture-fingerprint │
└────────────────────────────┬────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────┐
│           Policy & Gate Layer (策略引擎与门禁)            │
│    - evaluatePolicies          - vitest/jest-json-adapter   │
└────────────────────────────┬────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────┐
│          Storage Layer (JIT 内存 SQL + JSONL 双轨)       │
│    - bun:sqlite (:memory:)     - ctx-*.jsonl (append only)  │
└────────────────────────────┬────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────┐
│                 CLI Layer (命令行辅助与诊断)               │
│    - ritsu doctor              - ritsu bootstrap            │
└─────────────────────────────────────────────────────────┘
```

### 核心目录结构
```text
├── .claude/           # Claude Code 运行时规则
├── _shared/           # MCP 工具声明 (mcp-tools.yaml) 与 JSON 约束 Schema
├── rules/             # 策略过滤定义与 ast-grep 模式
├── skills/            # 7 个阶段 SKILL.md 指令定义 (前置 Prompt 缓存底座)
└── runtime/           # 运行时系统 (TypeScript)
    ├── src/
    │   ├── cli/       # doctor, bootstrap, export 等子指令
    │   ├── handlers/  # 核心 MCP Tool 处理器
    │   ├── policy/    # 9 大检测器及插件加载层
    │   └── orchestration/ # 契约同步与 preflight 调度
    └── tests/         # 60 组 Vitest 测试文件 (345 项验证用例)
```

---

## 🎛️ CLI 诊断工具

Ritsu 提供了开箱即用的 CLI 工具集，用于快速诊断项目配置与健康度：

```bash
ritsu doctor              # 进行全局健康体检 (最常用)
ritsu doctor --ecosystem  # 验证 MCP Server 挂载与响应
ritsu doctor --signals    # 对策略库与配置结构进行结构化 PASS/FAIL 评估
ritsu doctor --ai         # 验证当前 IDE / AI 客户端 (Claude/Cursor) 的集成环境
ritsu bootstrap           # 交互式初始化一个新项目
```

---

## 💡 兼容性

Ritsu 在以下主流 AI 编程助手中表现极佳，能够完全自动感应上下文：

* **Claude Code CLI**: 完美支持 `.claude/rules/` 自动触发。
* **Cursor IDE**: 通过 `.cursor/rules/ritsu.mdc` 自动对齐规则约束。
* **Codex CLI**: 支持 `CODEX.md` 全局工作流管控。

---

## 📄 许可

MIT © 2024-2026 3kaiu
