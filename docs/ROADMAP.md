# Ritsu Roadmap (2026 – 2028)

> 本文档定义 Ritsu 在 AI 能力快速演进背景下的 18 个月战略与执行节奏。
> 受众：贡献者、集成者、长期使用者。
> 更新策略：每个 Phase 结束时回顾并迭代本文档。

---

## 1. 核心战略

**不与 AI 模型比"生成能力"，专注做 AI 输出的"可信赖证据链"与"约束套件（Harness）"**。

软件工程正在回归真实世界的“社会工程问题”。人类拥有上下文难以描述的隐知识（真实需求、组织结构、资源限制等），未来的探索之路在于：**人类用自己的隐知识去驾驭工业化的生产结构**。
我们不再执着于手写代码，也不应抱怨 AI 产出太多无法 Review；相反，Ritsu 致力于提供**工业规模的测试和审查方案**，在严格的约束下驾驭 AI 完成高质量交付。

模型每 6 个月升级一次，会内化越来越多"AI 干活的能力"（planning、reflection、memory、tool use）。
Ritsu 要选 AI 越强反而越值钱的赛道：

| 让模型公司做 | 让 Ritsu 做 |
| --- | --- |
| 生成、推理、编排 | 验证、审计、治理 |
| 单 session 智能 | 跨 session / 跨 agent 一致性 |
| 模型私有 memory | 项目级共享知识资产 |
| 云端能力 | 本地化安全边界 |
| API 账单 | AI 行为经济学 |
| 手写代码 | 建立工业级约束与自动化审查标准 |

**基本共识**：
- AI 并不能替换生产者，它只能作为生产者的工具发挥工业级增效。
- 对工具的钻研必须服务于解决问题的根本目标。

**反指标**（出现说明走偏了）：
- Ritsu 自己变复杂、需要文档解释怎么用
- 模型升级后 Ritsu 用户立刻变少（说明在做"教 AI 干活"）
- 需要绑账号、需要 SaaS、需要订阅（违背 local-first / git-native）

---

## 2. 三阶段路线

### 🟢 Phase 1 (Months 0 – 6) — 自洽 + 政策引擎雏形

**目标**：让 Ritsu 自己能通过自己的红线，把"提示 AI 自觉"升级为"运行时强校验"。

**Epic**：
1. **E1 自洽收敛** — 版本号统一、dist orphan 清理、schema 与实际 skill 集合对齐
2. **E2 政策引擎雏形** — 5 条最易自动检测的 anti-pattern 改为运行时拦截器
3. **E3 契约 & 可观测性** — handler output_schema 强校验、emit-event 加 cost 字段、read-ctx tail-read

**验收信号**：Ritsu 自己跑一次 `/r-review` 能 PASS；`ritsu doctor` 零警告。

→ 详见 [phase-1-implementation.md](./phase-1-implementation.md)

---

### 🟡 Phase 2 (Months 6 – 12) — 多 Agent Substrate

**目标**：让 Ritsu 成为多模型协作的 event ledger。

**Epic**：
1. **E4 Trace 协议升级** — `correlation_id` → `trace_id + span_id`（OpenTelemetry 兼容），向后兼容
2. **E5 多 Agent 协调原语** — `ritsu_open_span` / `ritsu_close_span` / `ritsu_join_trace` + 新产物 `coordination-sheet`
3. **E6 CLI 升级** — `ritsu trace <id>` 树形渲染、跨 agent 决策回放

**验收信号**：一个 PR 由 ≥ 3 个异构模型（如 Claude + GPT + Gemini）协作完成，事件链完整可回放可审计。

→ Trace 协议设计：[rfc/001-multi-agent-trace.md](./rfc/001-multi-agent-trace.md)

---

### 🔵 Phase 3 (Months 12 – 18) — 组织级 Ledger + AI 行为复盘

**目标**：从个人工具跨越到团队级 AI 工程基础设施，保持 git-native，不引入 SaaS。

**Epic**：
1. **E7 Git-Native 共享** — `ritsu sync push/pull` 把 .ritsu/ 同步到 `refs/ritsu/*` 命名空间
2. **E8 GitHub App** — PR 自动渲染 design-sheet + verdict，CI 校验三方一致（design ↔ diff ↔ assurance）
3. **E9 月度复盘** — `ritsu retro` 自动产出失败模式聚合、accept rate、token 经济学
4. **E10 偏好挖掘** — `ritsu_mine_preferences` 离线扫 git log + .ritsu/ 历史反向推导项目偏好

**验收信号**：一个 5 人团队跑 3 个月后能在 5 分钟内回答：
- 上季度 AI 引入了多少 bug？
- 被 review 拒绝的最常见原因是什么？
- preferences 命中率提升了多少？

---

## 3. 显式拒绝做的事

| 不做 | 原因 |
| --- | --- |
| 自己 fine-tune 模型 | 模型公司在烧钱做 |
| Agent 编排框架 | LangGraph / Mastra / AutoGen 在做 |
| IDE 插件本体 | Cursor / Continue / Cline 在做 |
| 取代 CI/CD | GitHub Actions / Jenkins 在做 |
| 通用 prompt 模板库 | 无护城河 |
| 第一版 Web UI / SaaS Dashboard | 增加运维负担、稀释 git-native 优势 |
| 跨语言 SDK（Python/Go/Rust） | TypeScript runtime 暂时够用，扩张前先把核心做对 |
| 自定义 LLM provider 抽象 | 让 MCP 协议负责 |

**收敛原则**：Ritsu 只做一件事 —— 让 AI 写代码这件事可治理。

---

## 4. KPI

### 4.1 即期（Phase 1 – 2）

| 指标 | 目标 | 度量方式 |
| --- | --- | --- |
| 拦截率 | 单调上升 | 每月 Ritsu 拦截的 anti-pattern 数 / AI 提交总数 |
| 审计完整度 | > 80% | PR 同时含 design-sheet + dev-report + assurance-sheet 的比例 |
| 跨模型支持数 | ≥ 3 | 除 Claude 外正式支持的模型数（通过 MCP 接入） |

### 4.2 长期（Phase 3）

| 指标 | 目标 | 度量方式 |
| --- | --- | --- |
| 缺陷追溯率 | > 60% | 线上 bug 能在 .ritsu/ 历史里找到决策记录的比例 |
| 决策复用率 | > 30% | preferences 命中导致 AI 改方向的次数 / 总任务数 |
| 复盘 actionability | 单调上升 | 每月 retro 衍生的 anti-pattern 升级数 |

---

## 5. 变更日志

| 日期 | 变更 | 决策人 |
| --- | --- | --- |
| 2026-05-15 | 初版起草，三阶段路线确立 | 3kaiu |
