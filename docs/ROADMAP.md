# Ritsu Roadmap v2 (2026-05 → 2027-05)

> 本文档定义 Ritsu 在 AI 能力快速演进背景下的 12 个月战略与执行节奏。
> 受众：贡献者、集成者、长期使用者。
> 更新策略：每个 Phase 结束时回顾并迭代本文档。
> 上一版（治理优先）见 git 历史；本版重排为"以生成时刻为起点向外辐射"。
>
> **配套文档**：
> - [inventory.md](./inventory.md) — 项目当前状态全景盘点（v5.6.0 健康度评分）
> - [risk-register.md](./risk-register.md) — 18 项开放风险登记册
> - [v2-stress-test.md](./v2-stress-test.md) — 本路线的压力测试与修正建议（执行前必读）
> - [v2-execution-priority.md](./v2-execution-priority.md) — 基于已落地交叉重排的 7 个执行 batch

---

## 1. 战略与重排理由

### 1.1 北极星

让 AI 生成的代码质量持续上升 → 测试可机器追溯到契约 → review 能扛大 PR + 跨 PR 有记忆。**不与模型比生成能力，专做 AI 输出的可信证据链与约束套件**。

### 1.2 为什么重排

代码摸排发现 v1 路线（治理 + 审计为主线）与北极星有三处偏离：

1. **审计/治理半边已具雏形，但主动质量层接近空白**——契约↔测试映射、风险加权切片、跨 PR 记忆整条线没有代码。
2. **v1 暗示完工的 detector 其实是占位符**：`runtime/src/policy/detectors/scope-diff.ts` 与 `cross-file.ts` 都是 `return []`；`types.ts:19` 声明的 `ast` detector 连注册都没有，policy YAML 写 `type: ast` 会静默失败。
3. **生成端结果未传到验收端**：`skills/review/SKILL.md` 从不调用 `ritsu_run_quality_gates`，dev 跑的 lint/test 结果根本没进 review 决策；preferences 是只读不强制的自由文本。

故 v2 把权重从"治理"前移到"生成时刻闭环"，再向测试与 review 缩放辐射。

### 1.3 不变的边界

| 让模型公司做 | 让 Ritsu 做 |
| --- | --- |
| 生成、推理、编排 | 验证、审计、治理 |
| 单 session 智能 | 跨 session / 跨 agent 一致性 |
| 模型私有 memory | 项目级共享知识资产 |
| 云端能力 | 本地化安全边界 |

**反指标**（出现说明走偏）：
- Ritsu 自己变复杂、需要文档解释怎么用
- 模型升级后 Ritsu 用户立刻变少（说明在做"教 AI 干活"）
- 需要绑账号 / SaaS / 订阅（违背 local-first / git-native）

---

## 2. 四阶段路线

```
Phase A (M1–M3)  生成时刻闭环         → v5.4.0
Phase B (M4–M6)  测试充分性引擎       → v5.5.0
Phase C (M7–M8)  工业级 Review 缩放   → v5.6.0
Phase D (M9–M12) 闭环固化 + 团队层    → v6.0.0
```

### 2.1 🟢 Phase A · 生成时刻闭环 (Generation Time Closed-Loop) — ✅ 已完成 (v5.4.0)

**目标**：把 AI 生成代码的那一刻封死——契约可机器执行、preferences 可执行、生成结果必须流到下游。
**版本目标**：v5.4.0（直接跳过 v5.3，吃掉原 Phase 1 自洽硬指标）。

| ID | 任务 | 关键文件 |
| --- | --- | --- |
| **A1** | 落地 `scope-diff` 与 `cross-file` detector，启用 POL-005 / POL-004 运行时拦截 | `runtime/src/policy/detectors/scope-diff.ts` / `cross-file.ts` |
| **A2** | `policy/index.ts` detector 注册表加防呆——未注册 type 抛错，修 AST 静默失败 | `runtime/src/policy/index.ts:8-12` |
| **A3** | 吃掉原 Phase 1 自洽硬指标：版本号 SoT 统一（`version-check.js` hard fail）、`runtime/dist/` 退 git、skill 集合三方对齐、AGENTS.md ritsu block 模板化 | `runtime/version-check.js`、`runtime/scripts/sync-version.js`（新） |
| **A4** | `preferences-schema.yaml` 结构化升级：`pattern` 拆为 `match_regex` / `forbid_lib` / `require_call` 三种枚举形态（Phase B detector 的前置） | `_shared/preferences-schema.yaml` |
| **A5** | `artifact-schema.yaml` 的 `verification_plan` 加结构化 `contracts[]` 子字段（`{id, description, test_file_hint}`），设计 sheet 的契约从此机器可读 | `_shared/artifact-schema.yaml:61-62`、`_shared/artifact-templates.md` |
| **A6** | dev SKILL P1/P2 硬性把 `run_quality_gates` 结果写入 `dev-report`，不通过禁止 `emit_event(done)` | `skills/dev/SKILL.md:41,54` |
| **A7** | 新 handler `ritsu_diff_chunks`：按 hunk 切 + 风险加权（公共类型变 / SQL / 认证路径 / API 签名），Phase B/C 共同前置基础设施 | `runtime/src/handlers/diff-chunks.ts`（新） |

**DoD A**：Ritsu 自跑 `/r-dev`，未通过 quality_gates 无法 emit done；自身 `cross_file` detector 检出原 Phase 1 §3.1 列举的 6 处版本漂移；`ritsu doctor` 零警告；版本统一到 v5.4.0。

---

### 2.2 🟡 Phase B · 测试充分性引擎 (Test Sufficiency Engine) — ✅ 已完成 (v5.5.0)

**目标**：把测试从"跑得过"升级为"覆盖契约"。
**版本目标**：v5.5.0。

| ID | 任务 | 关键文件 |
| --- | --- | --- |
| **B1** | `run_quality_gates` 加 `coverage` 子字段（per-file + per-contract，包装 vitest v8 已有输出） | `runtime/src/handlers/run-quality-gates.ts:14-21` |
| **B2** | 新 skill `/r-augment`：读 `design-sheet.contracts[]` × coverage gap → 提议补测用例 → 写入 `dev-report.verification_result` | `skills/augment/SKILL.md`（新）、`.claude-plugin/marketplace.json` |
| **B3** | 新 detector `contract_coverage`：消费 A5 contracts × A7 hunk × B1 coverage，review 时校验每个 contract ≥ 1 个测试断言 | `runtime/src/policy/detectors/contract-coverage.ts`（新） |
| **B4** | `miner` 升级为半自动 promotion：`ritsu mine --report` 出候选，`ritsu mine --promote pref-N` 才写入 preferences；消费 B3 violation 作为高质量源信号 | `runtime/src/miner.ts:13-113`、`runtime/src/cli.ts` |

**DoD B**：仓库连续 10 个 PR 每个 design contract ≥ 1 个测试断言；miner 累计 promote ≥ 3 条规则；`/r-augment` 在 1 个真实 PR 上补出至少 1 个被 review 接受的边界用例。

**新增决策**：`/r-augment` 是新建独立 skill（不复用 `/r-test`），避免 v1 Phase 1 已决定下线 `/r-test` 的历史包袱。

---

### 2.3 🟠 Phase C · 工业级 Review 缩放 (Industrial Review Scaling) — ✅ 已完成 (v5.6.0)

**目标**：让大 PR review 不糊、生成端结果强制进入验收链。
**版本目标**：v5.6.0。

| ID | 任务 | 关键文件 |
| --- | --- | --- |
| **C1** | review SKILL P2 必须 `ritsu_join_trace` 后做三方比对：`design.contracts` ↔ `dev.gates` ↔ `assurance.verdict`，缺一不可 | `skills/review/SKILL.md:42-50` |
| **C2** | trace 协议层支持 sibling span + partial `assurance-sheet` 合并（**只做协议基础设施，不强制同模型自跑红蓝对抗**——异构模型 ready 时再 wiring） | `runtime/src/handlers/open-span.ts` / `close-span.ts` |
| **C3** | 新 CLI `ritsu doctor --hot-rules`：离线统计 30 天 `rule_id` 触发热度（取代 v1 暗示的 cross_pr_echo 实时查询，避免拖慢同步路径） | `runtime/src/cli.ts` |
| **C4** | review SKILL 强制 `emit_event(status: violation_detected)` 留痕，给 miner 提供持续源信号 | `skills/review/SKILL.md`、`_shared/ctx-event-schema.json` |

**DoD C**：1k+ LoC PR 走 review Critical 路径，token < 30k；`ritsu doctor --hot-rules` 在 Ritsu 自己仓库跑出 top 5 热点规则；review 缺任一证据链则 verdict 强制为 `needs_revision`。

---

### 2.4 🔵 Phase D · 闭环固化 + 团队层（M9–M12） — ✅ 已完成 (v6.0.0)

**目标**：把生成–测试–review–挖矿的闭环交付给团队层。
**版本目标**：v6.0.0。

| ID | 任务 | 关键文件 |
| --- | --- | --- |
| **D1** | AST detector 用 `ts-morph` 落地（仅 TS, 兜底 AP-2 unknown identifiers）；A2 防呆已就位 | `runtime/src/policy/detectors/ast.ts`（新） |
| **D2** | GitHub App MVP：PR 自动渲染 design ↔ dev ↔ assurance 三件套对账；CI 强制 `ritsu sync push` | `runtime/src/sync.ts`、外部仓 |
| **D3** | GitHub App CI 校验三方一致（design contracts × diff scope × assurance verdict） | C1 三方比对协议 |
| **D4** | CLI `ritsu doctor --health`：客观三指标——detector 命中率、miner promote 率、coverage 趋势（取代 v1 暗示的主观时间指标） | `runtime/src/cli.ts` |

**DoD D**：5 人团队 30 天数据，hot-rules 单调收敛；偏好 promote ≥ 10；新模型版本上线后所有 detector 无需修改。

---

## 3. 与 v1 路线的差异

| v1 项 | v2 处理 | 理由 |
| --- | --- | --- |
| Phase 1 自洽收敛（v5.3） | 吃进 Phase A，直接 v5.4 | 减少中间版本，避免单独发一版"自己擦屁股"的 release |
| 完整 OTel export | 只保留 sibling span 协议层 | OTel 完整兼容是"看上去专业"但用户用不上的成本 |
| cross_pr_echo 实时查询 | 降级为 doctor 离线统计（C3） | 历史扫描进同步路径会让 ctx 数月后膨胀失控，且需要 embedding 才能判定相似——命中"Ritsu 自己变复杂"反指标 |
| 同模型红蓝对抗自跑 | 取消（C2 只做协议层） | 同模型自我对话价值低；等多模型 ready 后由集成者 wiring |
| `/r-test` 复活 | 取消，新增 `/r-augment` | 避免与 v1 Phase 1 删除 `/r-test` 的决策冲突 |
| Phase 3 偏好自动挖矿成规则 | 改为半自动 promotion（B4） | 防止低质量自动规则污染整个项目的 AI 行为 |
| `ritsu doctor --usability` 主观时间 | 改为 D4 客观三指标 | 滞后指标不驱动决策 |

---

## 4. 显式拒绝做的事（与 v1 一致）

| 不做 | 原因 |
| --- | --- |
| 自己 fine-tune 模型 | 模型公司在烧钱做 |
| Agent 编排框架 | LangGraph / Mastra / AutoGen 在做 |
| IDE 插件本体 | Cursor / Continue / Cline 在做 |
| 取代 CI/CD | GitHub Actions / Jenkins 在做 |
| 通用 prompt 模板库 | 无护城河 |
| Web UI / SaaS Dashboard | 增加运维负担、稀释 git-native 优势 |
| 跨语言 SDK（Python/Go/Rust） | TypeScript runtime 暂时够用 |
| 自定义 LLM provider 抽象 | 让 MCP 协议负责 |

**收敛原则**：Ritsu 只做一件事——让 AI 写代码这件事可治理、可缩放。

---

## 5. KPI

### 5.1 即期（Phase A – B）

| 指标 | 目标 | 度量方式 |
| --- | --- | --- |
| Detector 拦截率 | 单调上升 | 每月运行时拦截的 violation 数 / AI 提交总数 |
| Contract 测试覆盖率 | > 80% | 含 contracts 的 design-sheet × 每个 contract 至少 1 个测试断言的比例 |
| 审计完整度 | > 80% | PR 同时含 design-sheet + dev-report + assurance-sheet 的比例 |
| 跨模型支持数 | ≥ 3 | 通过 MCP 接入的非 Claude 模型数 |

### 5.2 长期（Phase C – D）

| 指标 | 目标 | 度量方式 |
| --- | --- | --- |
| 大 PR review 可缩放 | 1k+ LoC token 用量 < 30k | C3 hot-rules + C1 三方比对 |
| 缺陷追溯率 | > 60% | 线上 bug 能在 `.ritsu/` 历史里找到决策记录的比例 |
| 偏好 promote 率 | > 30% | miner 候选 → 人工 promote 通过率 |
| 复盘 actionability | 单调上升 | 每月衍生的 anti-pattern 升级数 |

---

## 6. 端到端验证（每 Phase 一次 dogfooding）

**Phase A 完成后**：
```bash
cd runtime && node version-check.js && npm run build && node dist/cli.js doctor    # 零警告
# 故意写超出 design-sheet scope 的 diff，期望 POL-005 violation
# 故意改 _shared/ 某处版本号，期望 POL-004 violation
# policy YAML 写 type: ast，期望启动时抛错而非静默
```

**Phase B 完成后**：
- 写 2-contract design-sheet 但 dev 后只写 1 个测试 → `contract_coverage` 报缺
- `ritsu mine --report` 出候选 → `ritsu mine --promote pref-1` 写入 preferences

**Phase C 完成后**：
- 1k+ LoC PR 走 `/r-review` Critical，token < 30k
- 删 design.contracts 中一个 id → review verdict = `needs_revision`

**Phase D 完成后**：
- GitHub App 自动在 PR 评论三件套对账
- 删一个 export 但仍 import → AST detector 在 review 触发 AP-2
- `ritsu doctor --health` 三指标输出非空

**每 Phase 完工的硬条件：Ritsu 自身能通过自己定的红线**——这条延续 v1 的 dogfooding 原则。

---

## 7. 变更日志

| 日期 | 变更 | 决策人 |
| --- | --- | --- |
| 2026-05-15 | v1 初版起草，三阶段治理优先路线 | 3kaiu |
| 2026-05-15 | v2 重排为"生成时刻为起点向外辐射"四阶段路线；M1 直接吃 Phase 1 硬指标跳到 v5.4；新增 `/r-augment` skill | 3kaiu |
