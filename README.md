<div align="center">

# 律 (Ritsu) — AI Delivery Workflow Skill Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-294_✔-green.svg)](runtime/tests)
[![Runtime](https://img.shields.io/badge/Runtime-Bun_1.3+-blue.svg)](https://bun.sh)
[![Tech Stack](https://img.shields.io/badge/Tech_Stack-TypeScript-blue.svg)](https://www.typescriptlang.org)
[![Coverage](https://img.shields.io/badge/Coverage-85.7%25_lines-ok.svg)]()

**极速、轻量、高精度的 AI 自动化交付与架构防腐工作流引擎**

[核心理念](#-核心理念) • [核心特性](#-核心特性) • [安装与使用](#-安装与使用) • [架构设计](#-架构设计) • [CLI 诊断工具](#-cli-诊断工具) • [兼容性](#-兼容性)

</div>

---

## ⚡ 核心理念

Ritsu 是一个面向现代 AI 编码助手（Claude Code, Codex, Cursor）的**工作流指令与策略执行引擎**。

通过 7 个阶段指令和 10 个 MCP 工具，Ritsu 自动编排**11 个策略检测器**、**质量门禁**、**架构依赖图**、**传递依赖展开 (Blast Radius)**、**跨会话向量记忆**与 **Token 预算控制**，确保大型代码库在 AI 频繁修改下保持架构健康。

### 交付指令集 (Ritsu Skills)

| 指令 | 阶段 | 核心交付物 |
| :--- | :--- | :--- |
| **`/r-init`** | 契约初始化 | `AGENTS.md` 基线、生态配置 |
| **`/r-think`** | 需求分析与设计 | `design-sheet` / `design-brief` |
| **`/r-dev`** | 代码实现 | 质量门禁通过、`dev-report` |
| **`/r-review`** | 质量验收 | `assurance-sheet`、架构漂移审计 |
| **`/r-hunt`** | 智能排障 | `diagnosis` (根因 + 证据链) |
| **`/r-augment`** | 补测引擎 | 覆盖率缺口分析 + 补全用例 |
| **`/r-freestyle`** | 快速问答 | 零产物，直接回答 |

---

## 🚀 核心特性

### 🔒 策略引擎 (11 检测器)

| 检测器 | 类型 | 防护目标 |
|--------|------|---------|
| AstDetector | `ast` | 语法错误、未知标识符 (AP-2) |
| AstGrepDetector | `ast_grep` | 空 catch 块、debugger、console.log (AP-7/AP-13) |
| RegexDetector | `regex` | 占位符 (AP-6)、凭据泄露 (R-3)、SQL DROP (R-5) |
| ScopeDiffDetector | `scope_diff` | 范围蔓延 (AP-4) |
| SecuritySmellDetector | `security_smell` | eval/XSS/注入 (R-6) ★ v8.0 |
| ContractDriftDetector | `contract_drift` | 破坏性契约变更 (R-4) ★ v8.0 |
| CodeGraphDetector | `codegraph` | 未引用的导出、缺失测试 (CG-1/CG-2) |
| ArchitectureDetector | `architecture` | 架构漂移、循环依赖 (R-8) |
| CrossFileDetector | `cross_file` | 版本号同步 (R-2) |
| PreferenceLintDetector | `preference_lint` | 项目偏好合规 (AP-12) |
| ContractCoverageDetector | `contract_coverage` | 契约覆盖率对账 |

### 🎯 关键能力

- **传递依赖展开 (Blast Radius)**: 修改 `types.ts` → 自动扫描所有引用者，零 IO BFS 展开
- **IDE 规则 Active Sync**: `preflight` 执行后自动写入 `.cursor/rules/` + `.claude/rules/`，含 Mermaid 架构图
- **ImportGraph 内存依赖图**: 无需外部 CLI，从 AST cache 构建符号级依赖索引
- **Token Squeezer**: 优先级字段裁剪 + 响应出口 Token 预算检查
- **渐进式展开**: 三级 disclosure — 正常 → risk chunks → 完整上下文
- **自适应覆盖率阈值**: core (auth/payment/crypto) → 100%, periphery → 编译通过
- **偏好学习循环**: 5 种启发式模式 + LLM 合成 → `.ritsu/preferences.yaml`
- **Per-Stage 缓存前缀**: dev guardrails + review redlines 按阶段分离加载
- **多 Agent 状态**: `ritsu_agent_status` 查询活动 agent，避免文件冲突
- **3 段式 Prompt 拓扑**: Static Prefix → Skill Guide → Suffix Zone，标记 `_suffix: true`

---

## 📦 安装与使用

```bash
# 全局安装 Skill
npx skills add 3kaiu/Ritsu -a claude-code -g -y

# 检查运行环境
ritsu doctor

# 在 AI 助手中初始化项目
/r-init
```

---

## 🧭 架构设计

Ritsu 采用**六层架构**:

```
┌──────────────────────────────────────────────────────────────┐
│              Skills Layer (7 SKILL.md + 共享协议)              │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│            Orchestration Layer (调度控制中心)                  │
│  preflight-runner  →  architecture-analyzer  →  IDE sync    │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│           Policy & Gate Layer (11 检测器 + 质量门禁)          │
│  evaluatePolicies → blast-radius → import-graph → QG        │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│            Learning Layer (偏好挖掘 + 规则合成)               │
│  miner → heuristic-extractor → LLM-synthesizer              │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│          Storage Layer (SQLite WAL + JSONL + Vector)         │
│  bun:sqlite (:memory:) →  ctx-*.jsonl →  vectors.db         │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                 CLI Layer (诊断 + 学习 + 同步)                │
│  ritsu doctor  →  learn  →  trust  →  verify  →  export    │
└──────────────────────────────────────────────────────────────┘
```

### 核心目录结构
```text
├── .claude/rules/       # Claude Code 运行时规则 (handlers, policy, learning, arch)
├── .cursor/rules/       # Cursor IDE 架构规则 (auto-synced)
├── _shared/             # MCP 工具声明 + JSON Schema + 共享协议
├── rules/               # anti-patterns.yaml + ast-grep/ + dev-guardrails + review-redlines
├── skills/              # 7 个阶段 SKILL.md 指令 (含 Prompt Topology)
└── runtime/
    ├── src/
    │   ├── cli/         # doctor, bootstrap, export 等子指令
    │   ├── handlers/    # 10 个 MCP Tool 处理器 (整合后)
    │   ├── policy/      # 11 检测器 + blast-radius + import-graph
    │   └── orchestration/ # preflight + diff-inspect + architecture-analyzer
    └── tests/           # 61 组 Vitest 测试文件 (294 项用例)
```

---

## 🎛️ CLI 诊断工具

```bash
# 健康体检（最常用）
ritsu doctor
ritsu doctor --ecosystem    # MCP Server 挂载验证
ritsu doctor --signals      # 结构化 PASS/FAIL 审计
ritsu doctor --ai           # IDE/客户端集成检查
ritsu doctor --health       # 客观指标仪表板

# 偏好学习
ritsu mine --auto           # 自动扫描修正 + 合成规则 → preferences.yaml
ritsu learn                 # 同 mine --auto（MCP 工具别名）

# 安全
ritsu trust                 # 初始化 HMAC 密钥
ritsu verify <trace_id>     # 验证 Trace 签名

# 上下文与追踪
ritsu cat <cid>             # 查看 ctx 事件
ritsu trace <id>            # Trace 链路 + Span 树
ritsu export                # 月度任务报告

# 同步
ritsu sync push/pull        # .ritsu Git 同步
ritsu bootstrap             # 交互式初始化新项目
```

---

## 💡 兼容性

- **Claude Code**: `.claude/rules/` 自动加载，预检后实时回写架构上下文
- **Cursor IDE**: `.cursor/rules/ritsu-arch.mdc` 热加载 Mermaid 依赖图 + 约束
- **Codex CLI**: 支持 `CODEX.md` 全局工作流

---

## 📄 许可

MIT © 2024-2026 3kaiu
