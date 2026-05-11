# 律 (Ritsu) — AI 工程治理 Skill Bundle

> **版本**：v3.8.0 · **协议**：MIT  
> 一套为 AI 编程助手设计的工程级行为约束系统。让 AI 在任何项目中都能像经验丰富的工程师一样工作——有纪律、可溯源、不越权。

---

## 为什么需要 Ritsu？

AI 编程助手的默认行为存在以下工程风险：

| 问题                | 表现                             | Ritsu 的解法                                      |
| ------------------- | -------------------------------- | ------------------------------------------------- |
| 凭记忆捏造 API      | 引用不存在的函数导致编译失败     | `ritsu_exec("grep ...")` 强制验证标识符存在性     |
| 无设计直接写代码    | 代码偏离需求，返工成本高         | `think` 强制先评审需求再出 Handoff                |
| 审查流于形式        | 漏过安全漏洞和破坏性变更         | `review` 硬编码 Hard Stop 优先级拦截              |
| 会话重置丢上下文    | 新对话不知道做到哪一步了         | `ctx-{YYYY-MM}.jsonl` 记忆分片，支持 RAG 语义回溯 |
| 工具调用不确定      | 文字指令被 AI 随意解读           | MCP Tool Schema 声明，确定性工具调用              |
| 黑客恶意注入代码    | 外部 PR 包含恶意劫持 Prompt 指令 | **零信任沙盒 (Zero-Trust Sandbox)**，发现即熔断   |
| 记忆导致 Token 爆炸 | 无限堆叠日志或超大 Diff 文件卡死 | **智能 Diff 过滤** + **记忆分片与全文检索机制**   |
| 自动修改陷入死循环  | AI 写错后反复来回打回死循环      | **熔断机制 (Circuit Breaker)**，两次失败升维介入  |
| 产物目录暴露        | `ritsu/` 直白显示在项目根目录    | **隐藏目录 `.ritsu/`**，对齐 `.claude/` 业界惯例  |
| 纯 md 产物人读性差  | 审查报告/诊断报告在终端难以阅读  | **Markdown 统一格式**，AI 内联输出人类可读内容    |

---

## 架构总览

```
skills/Ritsu/
├── _shared/                    # 共享协议层（所有技能的基础设施）
│   ├── skill-common-steps.md   # 技能公共步骤模板（Pre-flight轻量豁免/fast/standard/hotfix模式/领域解析/ctx写入/统一交付摘要/关联流转）
│   ├── artifact-schema.yaml    # 产物格式契约（Schema 0-4，统一 Markdown）
│   ├── state-machine.yaml      # 全局流转路径与熔断规则
│   ├── ctx-protocol.md         # 情景记忆持久化协议（事件流：started/done/failed/artifact_written）
│   ├── ctx-event-schema.json   # ctx 事件 JSON Schema（机器可读，供 UI/TS 工具链消费）
│   └── mcp-tools.yaml          # MCP Tool Schema 声明（8 个工具 + 结构化调用模板 + output_schema）
│
├── rules/                      # 全局底线规则（任何技能执行前强制装载）
│   └── anti-patterns.yaml      # 12 条全局反模式底线 + 6 条 Review 红线
│
├── domains/                   # 领域自适应配置（YAML，每条规则带唯一 ID）
│   ├── _base.yaml              # 通用基线（所有领域隐式继承）
│   ├── frontend.yaml           # 前端增量
│   ├── backend.yaml            # 后端增量
│   ├── fullstack.yaml          # 全栈扁平化（已合并 base+frontend+backend，无需脑内继承）
│   ├── devops.yaml             # 运维增量
│   └── data.yaml               # 数据/ML 增量
│
├── runtime/                   # MCP Server 运行时（TypeScript，编译 YAML 协议为可执行工具）
│   ├── src/
│   │   ├── index.ts            # MCP Server 入口（stdio transport）
│   │   ├── schema-compiler.ts # mcp-tools.yaml → MCP Tool definitions 编译器
│   │   ├── event-validator.ts  # ctx-event-schema.json + ajv 事件校验
│   │   ├── ctx-store.ts        # .ritsu/ctx JSONL 读写 + correlation_id 生成
│   │   ├── shared.ts           # 共享路径工具 & 常量（单一事实来源）
│   │   ├── wasm-bridge.ts      # WASM 绑定层（Rust 加速 + JS 回退）
│   │   └── handlers/           # 8 个工具的运行时 handler (5 SDK + 3 业务)
│   ├── core/                    # Rust WASM 核心模块
│   │   └── src/
│   │       ├── event_validator.rs  # JSON Schema 校验 (jsonschema crate)
│   │       ├── ctx_index.rs        # JSONL 条目摘要索引 + O(1) 查询
│   │       └── correlation.rs     # correlation_id 原子生成器 (AtomicU32)
│   ├── package.json
│   └── tsconfig.json
│
└── skills/                     # 14 个可调用技能
    ├── route/                  # 调度入口：分析意图，路由至正确技能
    ├── pipe/                   # 流水线编排：按预设序列自动衔接技能（think/dev/review 等）
    ├── init/                   # 项目初始化：扫描技术栈，生成 AGENTS.md + 多 IDE ignore 自动注入
    ├── read/                   # 代码阅读：只读不写，解释逻辑、回答技术问题
    ├── think/                  # 需求评审 + 架构设计：问题+推荐方案模式，两阶段强制流程
    ├── dev/                    # 纯净编码：标识符验证、领域纪律、零占位符
    ├── refactor/               # 结构重构：提取/重命名/移动/合并，改结构不改行为
    ├── test/                   # 测试工程：策略制定 → 用例编写 → 执行验证 → 覆盖率分析
    ├── optimize/               # 代码精简优化：不改功能、只做减法和等价替换
    ├── review/                 # 对抗审查：Hard Stop 拦截 + 领域语义审查
    ├── hunt/                   # 根因诊断：MECE 假设 + 探针验证
    ├── deploy/                 # 部署发布：预发布检查 → 部署执行 → 冒烟验证 → 回滚方案
    ├── document/               # 文档维护：API 文档、README、CHANGELOG、JSDoc/TSDoc
    └── triage/                 # 工单裁决：Issue/PR 分类路由，不做技术诊断

---

## 🛡️ 工业级防御矩阵 (Deep Architecture)

除了业务视角的规范约束，Ritsu 在底层还部署了专为 LLM Agentic 协作设计的**终极防御机制**：

- **反 Prompt 注入 (Zero-Trust Sandbox)**：在 `review` 与 `triage` 阶段，对抓取到的 `git diff` 和 Issue 描述实施隔离。任何试图越权修改系统审查规则的指令，会被直接判定为 RCE 注入并拦截报警。
- **轻量级 RAG 记忆检索 (Local File-System RAG)**：按月时间分片 (`ctx-YYYY-MM.jsonl`)，避免单文件膨胀。AI 通过 `ritsu_exec` (grep) 检索 `.ritsu/` 目录下的 handoff/diagnosis 碎片，实现本地 RAG 问答。
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

此外，`/r-init` 支持 **技术栈特征自动嗅探（Deep Fingerprinting）**：不仅看 `package.json`，还会探测目录结构与关键文件（如 `.github/workflows/`、`components.json` 等）来识别子生态（如 Zustand/shadcn/ui），并把对应的项目级硬红线/纪律写入 `AGENTS.md` 的 `规则覆盖.rules_overrides`。

---

## 指令参考

| 指令                 | 用途                                                        | 典型场景             |
| -------------------- | ----------------------------------------------------------- | -------------------- |
| `/r-route`           | 不确定该用哪个指令时的调度入口                              | 新会话开始、任务切换 |
| `/r-init`            | 初始化项目，生成 AGENTS.md                                  | 首次接入新项目       |
| `/r-read [目标]`     | 代码阅读与解释，只读不写                                    | 理解代码/技术问答    |
| `/r-pipe {流水线}`   | 流水线编排：一条龙交付（standard/bugfix/optimize/test_add） | 端到端交付           |
| `/r-think [需求]`    | 需求评审 + 架构设计，输出 Handoff 文件                      | 开发新功能前         |
| `/r-dev [任务]`      | 按 Handoff 实现代码，含领域纪律检查                         | 写代码               |
| `/r-refactor [目标]` | 结构重构，改结构不改行为                                    | 提取模块/重命名/拆分 |
| `/r-opt [目标]`      | 代码精简优化，不改功能只做减法                              | 性能优化/代码瘦身    |
| `/r-review`          | 对抗式代码审查，输出 Review Stamp                           | 提交前 / PR 前       |
| `/r-hunt [报错]`     | 技术根因诊断，输出 Diagnosis 报告                           | 出现 Bug / 异常      |
| `/r-test [目标]`     | 测试工程：策略→用例→执行→覆盖率                             | 补测试/写测试        |
| `/r-deploy`          | 部署发布：预检→部署→冒烟→回滚方案                           | 上线/发布            |
| `/r-doc [目标]`      | 文档维护：API文档/README/CHANGELOG                          | 更新文档             |
| `/r-triage`          | Issue / PR 工单裁决与路由                                   | 处理 GitHub 工单     |

---

## 标准开发工作流

```
新需求
  │
  ├─ /r-route          ← 不确定从哪里开始？先问 route
  │
  ├─ /r-read [目标]    ← 先理解代码？纯阅读，只读不写
  │
  ├─ /r-think [需求]   ← Phase A: 需求评审（漏洞清单）
  │                      Phase B: 架构设计（输出 Handoff 文件）
  │
  ├─ /r-dev [handoff]  ← 按 Handoff 实施清单编码
  │                      标识符 grep 验证 + 质量门禁
  │
  ├─ /r-refactor [目标] ← 结构重构：提取/重命名/移动/合并
  │
  ├─ /r-test [目标]    ← 测试工程：策略→用例→执行→覆盖率
  │
  ├─ /r-review         ← Hard Stop 拦截 + 领域语义审查
  │    ├─ FAIL → 返回 /r-dev 修复
  │    └─ PASS → Review Stamp 写入文件
  │
  ├─ /r-deploy         ← 预发布检查 → 部署执行 → 冒烟验证 → 回滚方案
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
| `.ritsu/diagnosis-{ts}.md`       | `/r-hunt`   | 根因诊断报告（Markdown）                  |
| `.ritsu/review-stamp-{ts}.md`    | `/r-review` | 审查结论凭证（Markdown）                  |
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

领域通过 `_shared/skill-common-steps.md` Step 1 的三优先级协议自动解析，无需手动指定。

### Deep Fingerprinting（动态规则注入）

领域配置（`domains/*.yaml`）是 Bundle 的静态基线，但项目的“真实技术栈子生态”往往更细粒度。

`/r-init` 会把嗅探到的特征写入 `AGENTS.md`：

```yaml
规则覆盖:
  rules_overrides:
    add:
      - id: "PROJ-FE-ZUSTAND-1"
        name: "Zustand 状态不可变性"
        scope: "dev"
        rule: "对 Zustand store 的状态更新必须保持不可变性，并避免 selector 返回新引用导致无效重渲染"
```

这样后续技能在执行时即使不改 Bundle，也能按项目动态强化检查清单。

---

## 共享协议层说明

### skill-common-steps.md

技能公共步骤模板，包含：Step 0 Pre-flight + 执行模式选择（hotfix/fast/standard）+ 轻量技能豁免（read/triage/document 跳过 AGENTS.md 和环境确认）、Step 1 领域解析（三优先级协议）、Step 2 ctx 写入（4 种核心事件模板 + 失败恢复）、Step 3 关联流转（引用 state-machine.yaml）、Step 4 统一交付摘要模板（禁止各技能自定义格式）。所有技能必须引用此文件，**禁止各自实现领域判断或熔断规则**。

### artifact-schema.yaml

定义 5 种产物的强制格式（Schema 0-4，统一 Markdown）。`ritsu_write_artifact` 工具在写入时会校验格式合规性，发现占位符自动拒绝写入（Schema 0 AGENTS.md 豁免）。AGENTS.md 支持可选的 `rules_overrides` 字段（项目级禁用/降级/补充规则）。Review Stamp 支持可选的 `熔断反馈` 小节（供 `/r-think` 直接消费）。

### state-machine.yaml

定义所有技能之间的合法流转路径和标准引导话术。AI 可通过查询 `states.{current}.next` 确定性判定流转合法性。技能末尾的"关联流转"必须引用此文件，禁止自行编写路由文字。

### ctx-protocol.md

情景记忆按月分片与持久化协议。每个技能在启动和完成时追加一条 JSONL 记录到 `.ritsu/ctx-{YYYY-MM}.jsonl`，格式为：

```
{"ts":"...","skill":"...","domain":"...","status":"started|done|failed|artifact_written","artifact":"...|null"}
```

`/r-route` 启动时自动读取，识别 Git 现实对账后询问是否恢复。支持会话恢复行为协议（断点定位 → 跳过已完成步骤 → 恢复首行输出）。月度归档机制：超过 100 条时提示归档。

### mcp-tools.yaml

包含 8 个工具的 MCP Tool Schema 声明（含结构化调用模板）。YAML 源文件可编译为 JSON Schema 供 MCP 运行时注册。每个工具附带 `call_template` 和 `example`，LLM 按模板确定性构造调用参数，禁止自由推断。

> **工具定位**：5 个 SDK 原语（`emit_event`/`read_ctx`/`write_artifact`/`list_artifacts`/`exec`）+ 3 个高频业务封装（`get_changed_files`/`get_diff`/`run_quality_gates`）。`ritsu_validate` 已移除（emit_event 写入时自动校验）。业务封装工具将 AI 频繁组合的 `ritsu_exec` 调用固化为结构化输出，减少指令歧义和执行失败率。

### anti-patterns.yaml

12 条全局反模式底线 + 6 条 Review 红线，每条带唯一 ID（如 AP-1、R-3）和 severity 枚举（FATAL/WARN/HARD_STOP）。R-1 为 AP-2 的 review HARD_STOP 特化（单一真相源，不新增语义）。AI 在输出中引用 ID 而非模糊描述，确保确定性拦截。

---

## 全局底线规则（rules/）

无论当前执行哪个技能，以下规则**始终有效**：

**skill-common-steps.md Step 0**：每次技能执行前，必须先读取 `AGENTS.md` 加载项目约束，读取 `.env` / `package.json` 确认真实配置，不允许依赖记忆。read / triage / document 技能豁免 AGENTS.md 和环境确认步骤。

**anti-patterns.yaml**：12 条全局反模式底线 + 6 条 Review 红线，每条带唯一 ID（AP-1~AP-12, R-1~R-6）和 severity 枚举。包含：凭空臆测、幻觉路径、挤牙膏提问、范围蔓延、无证自信、占位符承诺、无视报错、自作主张升版、暴露 AI 身份、跳步、领域臆测、基线漂移。

---

## 版本历史

| 版本   | 核心变更                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| v3.8.0 | **架构优化：声明-实现闭环 + 去冗余 + 可配置化**：新增 pipe 流水线编排技能（14 技能）；dev 新增 --hotfix 微变更快速通道；所有技能补 fast_mode 声明；统一交付摘要模板（Step 4）；Pre-flight 轻量技能豁免；AP-2/R-1/HC-1 三层去重（单一真相源）；review→think 熔断反馈通道；AGENTS.md 新增 rules_overrides 项目级规则覆盖；fullstack 扁平化（消除伪继承）；ctx-event-schema 新增 pipe |
| v3.7.0 | **去冗余 + 交付闭环 + 复杂度可执行化**：移除 domain-resolver.md、state-machine transitions/ui_hint 死代码、ritsu_validate 工具、dual_format_protocol 遗物；简化 correlation_id 机制；统一 anti-patterns 与 HC 引用关系；新增 deploy/test 技能                                                                                                                                      |
| v3.6.0 | **事件精简 + 业务工具回归 + 上下文增强**：事件从 10 种精简为 4 种核心类型；恢复 3 个高频业务工具为结构化 MCP 工具；ritsu_read_ctx 增强 recovery/reality_check/circuit_breaker；移除 html 双格式；新增复杂度分级                                                                                                                                                                    |
| v3.5.x | **MCP Server 运行时 + 架构加固**：新增 runtime/ 目录（TypeScript MCP Server）；6 个 SDK 工具运行时实现；exec 安全边界白名单化；WASM 并发竞态修复；CI 补测试                                                                                                                                                                                                                        |
| v3.4.0 | **协议标准化**：ctx 事件扩展为全生命周期；新增 correlation_id；9 个 MCP 工具增加 output_schema；新增审批协议；新增 ctx-event-schema.json                                                                                                                                                                                                                                           |
| v3.3.x | **格式架构重构 + Context Engineering**：Markdown→YAML 迁移；pipe-delimited→JSONL；产物目录迁移至 `.ritsu/`；skill-common-steps 内联协议；结构化调用模板                                                                                                                                                                                                                            |
| ≤v3.2  | 底层架构深挖：RAG 记忆检索、IDE 焦点绑定、零信任沙盒、熔断机制、MCP Tool Schema、ctx 持久化、\_shared 共享层、六技能基础框架                                                                                                                                                                                                                                                       |     |

---

## 贡献

欢迎提交 Issue 反馈使用中遇到的 AI 执行偏差，或 PR 改进技能的指令精确性。

> 使用 Ritsu 自身来处理本仓库的工单：`/r-triage`
