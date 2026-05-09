# 律 (Ritsu) — AI 工程治理 Skill Bundle

> **版本**：v3.4.0 · **协议**：MIT  
> 一套为 AI 编程助手设计的工程级行为约束系统。让 AI 在任何项目中都能像经验丰富的工程师一样工作——有纪律、可溯源、不越权。

---

## 为什么需要 Ritsu？

AI 编程助手的默认行为存在以下工程风险：

| 问题                | 表现                             | Ritsu 的解法                                      |
| ------------------- | -------------------------------- | ------------------------------------------------- |
| 凭记忆捏造 API      | 引用不存在的函数导致编译失败     | `ritsu_grep_identifier` 强制验证标识符存在性      |
| 无设计直接写代码    | 代码偏离需求，返工成本高         | `think` 强制先评审需求再出 Handoff                |
| 审查流于形式        | 漏过安全漏洞和破坏性变更         | `review` 硬编码 Hard Stop 优先级拦截              |
| 会话重置丢上下文    | 新对话不知道做到哪一步了         | `ctx-{YYYY-MM}.jsonl` 记忆分片，支持 RAG 语义回溯 |
| 工具调用不确定      | 文字指令被 AI 随意解读           | MCP Tool Schema 声明，确定性工具调用              |
| 黑客恶意注入代码    | 外部 PR 包含恶意劫持 Prompt 指令 | **零信任沙盒 (Zero-Trust Sandbox)**，发现即熔断   |
| 记忆导致 Token 爆炸 | 无限堆叠日志或超大 Diff 文件卡死 | **智能 Diff 过滤** + **记忆分片与全文检索机制**   |
| 自动修改陷入死循环  | AI 写错后反复来回打回死循环      | **熔断机制 (Circuit Breaker)**，两次失败升维介入  |
| 产物目录暴露        | `ritsu/` 直白显示在项目根目录    | **隐藏目录 `.ritsu/`**，对齐 `.claude/` 业界惯例  |
| 纯 md 产物人读性差  | 审查报告/诊断报告在终端难以阅读  | **md+html 双格式**，AI 读 md，人类浏览器看 html   |

---

## 架构总览

```
skills/Ritsu/
├── _shared/                    # 共享协议层（所有技能的基础设施）
│   ├── domain-resolver.md      # 统一领域判断协议（frontend/backend/fullstack/infra/data）
│   ├── skill-common-steps.md   # 技能公共步骤模板（结构化输出协议/领域解析/ctx写入/关联流转）
│   ├── artifact-schema.yaml    # 产物格式契约（Schema 0-4 + 双格式协议）
│   ├── state-machine.yaml      # 全局流转路径与标准引导话术
│   ├── ctx-protocol.md         # 情景记忆持久化协议（事件流：started/step_done/approval_required/artifact_written/done）
│   ├── ctx-event-schema.json   # ctx 事件 JSON Schema（机器可读，供 UI/TS 工具链消费）
│   └── mcp-tools.yaml          # MCP Tool Schema 声明（8 个工具 + 结构化调用模板）
│
├── rules/                      # 全局底线规则（任何技能执行前强制装载）
│   ├── context-loader.md       # 强制上下文装载序列（AGENTS.md + 环境配置）
│   └── anti-patterns.yaml      # 12 条全局反模式底线 + 6 条 Review 红线
│
├── domains/                   # 领域自适应配置（YAML，每条规则带唯一 ID）
│   ├── _base.yaml              # 通用基线（所有领域隐式继承）
│   ├── frontend.yaml           # 前端增量
│   ├── backend.yaml            # 后端增量
│   ├── fullstack.yaml          # 全栈增量
│   ├── devops.yaml             # 运维/基础设施增量
│   └── data.yaml               # 数据/ML 增量
│
└── skills/                     # 8 个可调用技能
    ├── route/                  # 调度入口：分析意图，路由至正确技能
    ├── init/                   # 项目初始化：扫描技术栈，生成 AGENTS.md + 多 IDE ignore 自动注入
    ├── think/                  # 需求评审 + 架构设计：问题+推荐方案模式，两阶段强制流程
    ├── dev/                    # 纯净编码：标识符验证、领域纪律、零占位符
    ├── optimize/               # 代码精简优化：不改功能、只做减法和等价替换
    ├── review/                 # 对抗审查：Hard Stop 拦截 + 领域语义审查
    ├── hunt/                   # 根因诊断：MECE 假设 + 探针验证
    └── triage/                 # 工单裁决：Issue/PR 分类路由，不做技术诊断

---

## 🛡️ 工业级防御矩阵 (Deep Architecture)

除了业务视角的规范约束，Ritsu 在底层还部署了专为 LLM Agentic 协作设计的**终极防御机制**：

- **反 Prompt 注入 (Zero-Trust Sandbox)**：在 `review` 与 `triage` 阶段，对抓取到的 `git diff` 和 Issue 描述实施隔离。任何试图越权修改系统审查规则的指令，会被直接判定为 RCE 注入并拦截报警。
- **轻量级 RAG 记忆检索 (Local File-System RAG)**：摒弃了无限膨胀的单一 `ctx.md`，转为**按月时间分片** (`ctx-YYYY-MM.jsonl`)。AI 可调用 `ritsu_retrieve_memory` 工具，利用本地文件全文检索技术（Keyword/Semantic），横跨数年精准调取历史架构决策与 Bug 诊断。
- **Git 时空错位自适应 (Temporal Reality Check)**：自动识别由于开发人员执行 `git reset --hard` 回退代码而造成的任务状态不一致，自适应回拨记忆系统至未完成状态。
- **IDE 焦点隐式绑定 (Zero-Click Context)**：在 Cursor / Windsurf 中，无需啰嗦指定文件。只要 IDE 编辑器激活了某个 `handoff` 设计稿或错误日志，`/r-dev` 会瞬间隐式绑定并开工，消除"废话交互轮次"。
- **防死循环熔断器 (Circuit Breaker)**：开发-审查链路一旦触发**两次连续失败**，系统将强制切断重试循环，将问题弹回至 `/r-think` 层进行架构重审，极大降低 Token 的无意义消耗。
- **防止底层工具失控**：强加了命令隔离、排除无关大型生成文件的 Diff 限流，以及并发原子写锁 (Mutex)。
```

---

## 快速开始

### 安装

Ritsu 支持现代化的 Claude Plugin 体系和通用 `npx skills` 工具，你可以通过一条命令将其安装到你所使用的任何 AI IDE 或助手中。

**Claude Code**

```bash
# 方式 1：终端 CLI 快速全局安装
npx skills add 3kaiu/Ritsu -a claude-code -g -y

# 方式 2：使用 Marketplace 插件模式
/plugin marketplace add 3kaiu/Ritsu
/plugin install ritsu@ritsu
```

**Cursor / Windsurf / Codex / Cline 等**
得益于统一的技能包规范，你可以一键将 Ritsu 安装到你的目标编辑器中：

```bash
# 安装到 Cursor
npx skills add 3kaiu/Ritsu -a cursor -g -y

# 安装到 Windsurf
npx skills add 3kaiu/Ritsu -a windsurf -g -y

# 安装到 Cline / Codex 等
npx skills add 3kaiu/Ritsu -a cline -g -y
npx skills add 3kaiu/Ritsu -a codex -g -y
```

> **提示**：安装到 Cursor / Windsurf 后，你可以直接在 Chat 面板中通过 `@` 提及对应的技能文件（如 `@SKILL.md`），或者将它们加入到项目的 `.cursorrules` / `.windsurfrules` 中实现自动化触发。

### 初始化项目

安装完毕后，在任何一个你需要接入规范的新项目中，第一步运行：

```
/r-init
```

Ritsu 会扫描项目技术栈，生成 `AGENTS.md`（项目级约束基线），可选生成 `.cursorrules` / `.windsurfrules` 路由配置，并自动向 `.gitignore` 注入 `.ritsu/`、`.claude/` 及对应 IDE 的会话缓存和个人配置文件。

---

## 指令参考

| 指令              | 用途                                   | 典型场景             |
| ----------------- | -------------------------------------- | -------------------- |
| `/r-route`        | 不确定该用哪个指令时的调度入口         | 新会话开始、任务切换 |
| `/r-init`         | 初始化项目，生成 AGENTS.md             | 首次接入新项目       |
| `/r-think [需求]` | 需求评审 + 架构设计，输出 Handoff 文件 | 开发新功能前         |
| `/r-dev [任务]`   | 按 Handoff 实现代码，含领域纪律检查    | 写代码               |
| `/r-opt [目标]`   | 代码精简优化，不改功能只做减法         | 性能优化/代码瘦身    |
| `/r-review`       | 对抗式代码审查，输出 Review Stamp      | 提交前 / PR 前       |
| `/r-hunt [报错]`  | 技术根因诊断，输出 Diagnosis 报告      | 出现 Bug / 异常      |
| `/r-triage`       | Issue / PR 工单裁决与路由              | 处理 GitHub 工单     |

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

所有 Ritsu 产物统一写入项目根目录的 `.ritsu/` 隐藏子目录（对齐 `.claude/` 等业界惯例，避免污染项目文件树）：

| 文件                             | 由谁生成    | 用途                                      |
| -------------------------------- | ----------- | ----------------------------------------- |
| `AGENTS.md`                      | `/r-init`   | 项目级技术栈与质量门禁约束                |
| `.ritsu/handoff-{slug}.md`       | `/r-think`  | 架构设计与实施清单，dev/review 的溯源依据 |
| `.ritsu/diagnosis-{ts}.md`       | `/r-hunt`   | 根因诊断报告（md，AI 消费）               |
| `.ritsu/diagnosis-{ts}.html`     | `/r-hunt`   | 根因诊断报告（html，人类可视化）          |
| `.ritsu/review-stamp-{ts}.md`    | `/r-review` | 审查结论凭证（md，AI 消费）               |
| `.ritsu/review-stamp-{ts}.html`  | `/r-review` | 审查结论凭证（html，人类可视化）          |
| `.ritsu/optimize-report-{ts}.md` | `/r-opt`    | 优化执行报告（md，AI 消费）               |
| `.ritsu/ctx-{YYYY-MM}.jsonl`     | 所有技能    | 任务执行日志时间分片，会话恢复的情景记忆  |

---

## 领域自适应

Ritsu 支持 5 种工程领域，每个技能根据领域动态调整检查清单：

| 领域值      | 适用场景              | 特有检查项                          |
| ----------- | --------------------- | ----------------------------------- |
| `frontend`  | React / Vue / 移动端  | 重渲染控制、竞态防御、XSS、内存泄漏 |
| `backend`   | API / 数据库 / 微服务 | 事务边界、连接释放、SQL 注入、死锁  |
| `fullstack` | 前后端同时涉及        | 两侧检查 + BFF/SSR/统一鉴权链路     |
| `infra`     | DevOps / IaC / CI     | 变更幂等性、最小权限、状态文件保护  |
| `data`      | 数据管道 / ML 工程    | 数据血缘、重跑幂等性、质量检测层    |

领域通过 `_shared/domain-resolver.md` 的三优先级协议自动解析，无需手动指定。

---

## 共享协议层说明

### domain-resolver.md

统一的领域判断入口。所有技能必须引用此协议，**禁止各自实现领域判断逻辑**。解析后输出 `[RITSU_CTX: domain=X]` 标记供下游技能读取。

### artifact-schema.yaml

定义 7 种产物的强制格式（Schema 0-4 + 双格式协议）。`ritsu_write_artifact` 工具在写入时会校验格式合规性，发现占位符自动拒绝写入（Schema 0 AGENTS.md 豁免）。面向人类的产物（Diagnosis / Review Stamp）同时输出 md 和 html 双文件。Handoff 产物支持 append-only Changelog 追踪契约变更。

### state-machine.yaml

定义所有技能之间的合法流转路径和标准引导话术。AI 可通过查询 `states.{current}.next` 确定性判定流转合法性。技能末尾的"关联流转"必须引用此文件，禁止自行编写路由文字。

### ctx-protocol.md

情景记忆按月分片与持久化协议。每个技能在启动和完成时追加一条 JSONL 记录到 `.ritsu/ctx-{YYYY-MM}.jsonl`，格式为：

```
{"ts":"...","skill":"...","domain":"...","status":"started|done|failed","artifact":"...|null"}
```

`/r-route` 启动时自动读取，识别 Git 现实对账后询问是否恢复。支持月度摘要机制（跨月恢复仅读 1 条摘要）和会话恢复行为协议（断点定位 → 跳过已完成步骤 → 恢复首行输出）。

### mcp-tools.yaml

包含 8 个带有强防幻觉拦截能力的 MCP Tool Schema 声明（含 RAG 检索 + 结构化调用模板）。YAML 源文件可编译为 JSON Schema 供 MCP 运行时注册。每个工具附带 `call_template` 和 `example`，LLM 按模板确定性构造调用参数，禁止自由推断。

### anti-patterns.yaml

12 条全局反模式底线 + 6 条 Review 红线，每条带唯一 ID（如 AP-1、R-3）和 severity 枚举（FATAL/WARN/HARD_STOP）。AI 在输出中引用 ID 而非模糊描述，确保确定性拦截。

---

## 全局底线规则（rules/）

无论当前执行哪个技能，以下规则**始终有效**：

**context-loader.md**：每次技能执行前，必须先读取 `AGENTS.md` 加载项目约束，读取 `.env` / `package.json` 确认真实配置，不允许依赖记忆。

**anti-patterns.yaml**：12 条全局反模式底线 + 6 条 Review 红线，每条带唯一 ID（AP-1~AP-12, R-1~R-6）和 severity 枚举。包含：凭空臆测、幻觉路径、挤牙膏提问、范围蔓延、无证自信、占位符承诺、无视报错、自作主张升版、暴露 AI 身份、跳步、领域臆测、基线漂移。

---

## 版本历史

| 版本   | 核心变更                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v3.4.0 | **协议标准化 (Protocol Standardization)**：ctx 事件从 3 态(started/done/failed)扩展为全生命周期事件流(step_done/step_failed/approval_required/artifact_written/circuit_breaker)；8 个 MCP 工具增加 output_schema（UI 可渲染 ToolCallCard）；状态机增加 transitions+ui_hint（UI 可做状态动画）；新增审批协议(approval_required/granted/denied)；新增 violation 事件格式；skill-common-steps.md 增加 step 级 ctx 写入模板；ritsu_write_artifact 增加 artifact_meta 参数。所有改动向后兼容，旧 LLM 忽略新字段照常工作。                                                                                                                                                    |
| v3.3.1 | **LLM 底层架构深度优化 + Context Engineering**：skill-common-steps.md 内联关键协议消除 3 层间接引用 + 增加结构化输出协议(Step 0)；8 个 SKILL.md 增加 token_budget + required_sections + Step Complete 锚点 + 删除三重声明冗余表格；mcp-tools.yaml 增加结构化调用模板；context-loader.md 增加按需加载 section 映射；ctx-protocol.md 增加月度摘要 + 会话恢复行为协议；Handoff 增加 append-only Changelog；think 改为问题+推荐方案模式（禁止只抛问题不给解法）；init 自动注入多 IDE AI 产物 ignore 规则（含 .cursorrules/.windsurfrules 个人配置）；optimize 分析清单从 emoji tree 改为结构化表格；JSONL 模板全部修正为单行格式；全局版本号统一；AP-6 增加 Schema 0 豁免。 |
| v3.3.0 | **格式架构重构 + 产物隐藏化 + 双格式输出**：配置/约束/状态机/工具声明从 Markdown 迁移至 YAML（Token 减 25%、准确率最高、每条规则带唯一 ID）；ctx 日志从 pipe-delimited 迁移至 JSONL（原子追加、流式读取、jq 查询）；产物目录从 `ritsu/` 迁移至 `.ritsu/`（对齐 `.claude/` 隐藏目录惯例）；Diagnosis / Review Stamp 引入 md+html 双格式（AI 读 md，人类浏览器看 html）。                                                                                                                                                                                                                                                                                                 |
| v3.2.0 | **底层效能与防御飞升**：引入本地 RAG 记忆检索、IDE 焦点隐式绑定、零信任 Prompt 防注入沙盒、防死循环熔断、Diff Token 限流、并发锁与 Git 现实对账。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| v3.1.0 | **异构安装体系**：支持 `npx skills` 工具安装，增加 `.claude-plugin` 目录，并实现在项目中与其他 AI 产物的无损兼容注入。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| v3.0.0 | 底层架构深挖：HEAD/TAIL 双锚定、否定→正向指令替换、MCP Tool Schema、ctx 情景记忆持久化                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| v2.1.0 | 收束性修复：git diff 命令修正、Schema 0（AGENTS.md）、Review Stamp 写文件、think 两阶段强制流程                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| v2.0.0 | 结构性重构：\_shared 共享层、route 新技能、artifact-schema、state-machine 统一话术                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| v1.x   | 初始版本：六技能基础框架                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

---

## 贡献

欢迎提交 Issue 反馈使用中遇到的 AI 执行偏差，或 PR 改进技能的指令精确性。

> 使用 Ritsu 自身来处理本仓库的工单：`/r-triage`
