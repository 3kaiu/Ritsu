# 律 (Ritsu) — AI 工程治理 Skill Bundle

> **版本**：v3.0.0 · **协议**：MIT  
> 一套为 AI 编程助手设计的工程级行为约束系统。让 AI 在任何项目中都能像经验丰富的工程师一样工作——有纪律、可溯源、不越权。

---

## 为什么需要 Ritsu？

AI 编程助手的默认行为存在以下工程风险：

| 问题 | 表现 | Ritsu 的解法 |
|------|------|-------------|
| 凭记忆捏造 API | 引用不存在的函数导致编译失败 | `ritsu_grep_identifier` 强制验证标识符存在性 |
| 无设计直接写代码 | 代码偏离需求，返工成本高 | `think` 强制先评审需求再出 Handoff |
| 审查流于形式 | 漏过安全漏洞和破坏性变更 | `review` 硬编码 Hard Stop 优先级拦截 |
| 会话重置丢上下文 | 新对话不知道做到哪一步了 | `ctx.md` 持久化任务日志，可随时恢复 |
| 工具调用不确定 | 文字指令被 AI 随意解读 | MCP Tool Schema 声明，确定性工具调用 |

---

## 架构总览

```
skills/Ritsu/
├── _shared/                    # 共享协议层（所有技能的基础设施）
│   ├── domain-resolver.md      # 统一领域判断协议（frontend/backend/fullstack/infra/data）
│   ├── artifact-schema.md      # 所有产物的格式契约（AGENTS.md/Handoff/Diagnosis/Stamp）
│   ├── state-machine.md        # 全局流转路径与标准引导话术
│   ├── ctx-protocol.md         # 情景记忆持久化协议（ritsu/ctx.md）
│   └── mcp-tools.md            # MCP Tool Schema 声明（6 个工具）
│
├── rules/                      # 全局底线规则（任何技能执行前强制装载）
│   ├── context-loader.md       # 强制上下文装载序列（AGENTS.md + 环境配置）
│   └── anti-patterns.md        # 9 条全局反模式底线
│
└── skills/                     # 7 个可调用技能
    ├── route/                  # 调度入口：分析意图，路由至正确技能
    ├── init/                   # 项目初始化：扫描技术栈，生成 AGENTS.md
    ├── think/                  # 需求评审 + 架构设计：两阶段强制流程
    ├── dev/                    # 纯净编码：标识符验证、领域纪律、零占位符
    ├── review/                 # 对抗审查：Hard Stop 拦截 + 领域语义审查
    ├── hunt/                   # 根因诊断：MECE 假设 + 探针验证
    └── triage/                 # 工单裁决：Issue/PR 分类路由，不做技术诊断
```

---

## 快速开始

### 安装

Ritsu 是纯 Markdown 文件，无需安装任何依赖。将本仓库克隆到你的 AI 助手的 Skills 目录：

```bash
# Antigravity / Gemini
git clone <repo-url> ~/.gemini/antigravity/skills/Ritsu

# 其他 AI 助手（按各自 Skills 目录约定放置）
git clone <repo-url> /path/to/your/ai/skills/Ritsu
```

### 初始化项目

在任何新项目中，第一步运行：

```
/r-init
```

Ritsu 会扫描项目技术栈，生成 `AGENTS.md`（项目级约束基线），并可选生成 `.cursorrules` / `.windsurfrules` 路由配置。

---

## 指令参考

| 指令 | 用途 | 典型场景 |
|------|------|---------|
| `/r-route` | 不确定该用哪个指令时的调度入口 | 新会话开始、任务切换 |
| `/r-init` | 初始化项目，生成 AGENTS.md | 首次接入新项目 |
| `/r-think [需求]` | 需求评审 + 架构设计，输出 Handoff 文件 | 开发新功能前 |
| `/r-dev [任务]` | 按 Handoff 实现代码，含领域纪律检查 | 写代码 |
| `/r-review` | 对抗式代码审查，输出 Review Stamp | 提交前 / PR 前 |
| `/r-hunt [报错]` | 技术根因诊断，输出 Diagnosis 报告 | 出现 Bug / 异常 |
| `/r-triage` | Issue / PR 工单裁决与路由 | 处理 GitHub 工单 |

---

## 标准开发工作流

```
新需求
  │
  ├─ /r-route          ← 不确定从哪里开始？先问 route
  │
  ├─ /r-think [需求]   ← Phase A: 需求评审（漏洞清单）
  │                      Phase B: 架构设计（输出 Handoff 文件）
  │
  ├─ /r-dev [handoff]  ← 按 Handoff 实施清单编码
  │                      标识符 grep 验证 + 质量门禁
  │
  ├─ /r-review         ← Hard Stop 拦截 + 领域语义审查
  │    ├─ FAIL → 返回 /r-dev 修复
  │    └─ PASS → Review Stamp 写入文件
  │
出现 Bug
  │
  ├─ /r-triage         ← Issue 信息完整？路由 hunt / 要求补充
  │
  └─ /r-hunt [报错]    ← MECE 假设 → 探针验证 → 根因报告
       ├─ 简单修复 → /r-dev
       └─ 架构级  → /r-think
```

---

## 产物文件（Project Artifacts）

所有 Ritsu 产物统一写入项目根目录的 `ritsu/` 子目录：

| 文件 | 由谁生成 | 用途 |
|------|---------|------|
| `AGENTS.md` | `/r-init` | 项目级技术栈与质量门禁约束 |
| `ritsu/handoff-{slug}.md` | `/r-think` | 架构设计与实施清单，dev/review 的溯源依据 |
| `ritsu/diagnosis-{ts}.md` | `/r-hunt` | 根因诊断报告，附证据链与验证命令 |
| `ritsu/review-stamp-{ts}.md` | `/r-review` | 审查结论凭证，含 Hard Stop 命中情况 |
| `ritsu/ctx.md` | 所有技能 | 任务执行日志，会话恢复的情景记忆 |

---

## 领域自适应

Ritsu 支持 5 种工程领域，每个技能根据领域动态调整检查清单：

| 领域值 | 适用场景 | 特有检查项 |
|-------|---------|----------|
| `frontend` | React / Vue / 移动端 | 重渲染控制、竞态防御、XSS、内存泄漏 |
| `backend` | API / 数据库 / 微服务 | 事务边界、连接释放、SQL 注入、死锁 |
| `fullstack` | 前后端同时涉及 | 两侧检查 + BFF/SSR/统一鉴权链路 |
| `infra` | DevOps / IaC / CI | 变更幂等性、最小权限、状态文件保护 |
| `data` | 数据管道 / ML 工程 | 数据血缘、重跑幂等性、质量检测层 |

领域通过 `_shared/domain-resolver.md` 的三优先级协议自动解析，无需手动指定。

---

## 共享协议层说明

### domain-resolver.md
统一的领域判断入口。所有技能必须引用此协议，**禁止各自实现领域判断逻辑**。解析后输出 `[RITSU_CTX: domain=X]` 标记供下游技能读取。

### artifact-schema.md
定义 5 种产物的强制格式（Schema 0-3）。`ritsu_write_artifact` 工具在写入时会校验格式合规性，发现占位符自动拒绝写入。

### state-machine.md
定义所有技能之间的合法流转路径和标准引导话术。技能末尾的"关联流转"必须引用此文件，禁止自行编写路由文字。

### ctx-protocol.md
情景记忆持久化协议。每个技能在启动和完成时追加一条记录到 `ritsu/ctx.md`，格式为：
```
{YYYYMMDD-HHMMSS} | {skill} | domain={value} | {started|done|failed} | {artifact|none}
```
`/r-route` 启动时自动读取，识别未完成任务并询问是否恢复。

### mcp-tools.md
6 个 MCP Tool 的 Schema 声明。把 AI 的工具调用从"解读自然语言指令"升级为"按 Schema 确定性调用"，每个工具包含输入参数、返回格式和错误处理路径。

---

## 全局底线规则（rules/）

无论当前执行哪个技能，以下规则**始终有效**：

**context-loader.md**：每次技能执行前，必须先读取 `AGENTS.md` 加载项目约束，读取 `.env` / `package.json` 确认真实配置，不允许依赖记忆。

**anti-patterns.md**：9 条全局反模式底线，包含：凭空臆测、幻觉路径、挤牙膏提问、范围蔓延、无证自信、占位符承诺、无视报错、自作主张升版、暴露 AI 身份。

---

## 版本历史

| 版本 | 核心变更 |
|------|---------|
| v3.0.0 | 底层架构深挖：HEAD/TAIL 双锚定、否定→正向指令替换、MCP Tool Schema、ctx 情景记忆持久化 |
| v2.1.0 | 收束性修复：git diff 命令修正、Schema 0（AGENTS.md）、Review Stamp 写文件、think 两阶段强制流程 |
| v2.0.0 | 结构性重构：_shared 共享层、route 新技能、artifact-schema、state-machine 统一话术 |
| v1.x | 初始版本：六技能基础框架 |

---

## 贡献

欢迎提交 Issue 反馈使用中遇到的 AI 执行偏差，或 PR 改进技能的指令精确性。

> 使用 Ritsu 自身来处理本仓库的工单：`/r-triage`
