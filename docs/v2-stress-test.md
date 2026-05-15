# v2 ROADMAP 压力测试

> **生成日期**：2026-05-15
> **目的**：在 v2 ROADMAP 进入执行前，逐 Phase 挑战其前提假设、识别隐性依赖、找出更高 ROI 的替代项
> **基准文档**：[ROADMAP.md](./ROADMAP.md) v2
> **使用方式**：每条挑战独立判断——若仍坚持原方案，请在执行 Story 时记录"为何选择不采纳该挑战"；若采纳，按"修正建议"调整 Phase 内任务列表
> **关联**：[inventory.md](./inventory.md) §9 已落地交叉为部分挑战提供了证据

---

## Phase A · 生成时刻闭环 — 压力测试

### A1 detector 实现

**假设**：scope-diff / cross-file detector 实现简单，"占位符变实现"是 2 周内的工作。

**挑战**：
- `scope_diff` 需要解析 design-sheet 中 `in_scope` 列表（schema 中是 string list），然后和 `git diff --name-only` 匹配。glob 通配？exact match？子路径（`src/foo/`）如何匹配 `src/foo/bar.ts`？
- `cross_file` 需要扫描所有声明 version 字段的文件——但"version 字段"在不同文件里语法不同（package.json `"version": "5.2.0"` vs YAML `version: "5.2.0"` vs README `v5.2.0`）。这是 6+ 种格式的语义提取，不是单一 regex。
- 误报代价：scope_diff 一旦误报会阻塞合法 PR；cross_file 误报会引发 release 工作流锁死。

**修正建议**：
- scope_diff 第一版只做 exact 文件路径匹配 + 目录前缀匹配（用 minimatch 库）；复杂场景退化为 WARN 而非 FATAL
- cross_file 第一版只扫 4 类指定文件（package.json / AGENTS.md / marketplace.json / CHANGELOG.md），不通用化
- 两个 detector 都要在 anti-patterns.yaml 加 `confidence` 字段，低于阈值时只 warn 不 hard_stop

**结论**：保留 A1 但明确"第一版做最简实现，复杂语义留 v2.1"。

---

### A4 preferences schema 结构化

**假设**：30 行 schema 改动即可。

**挑战**（已被 [inventory.md](./inventory.md) §9 验证）：
- schema 字段 (`match_regex` / `forbid_lib` / `require_call`) 实际**已经存在**——这部分工作已完成。
- 真正的工作是写 **preference_lint detector** 消费这些字段——这是 A4 没有写明的、却是高复杂度的部分。
- 估计实际工作量：detector 1 周 + dev/review SKILL 集成 0.5 周 + 测试 0.5 周。

**修正建议**：
- A4 拆为：
  - **A4a (已完成)** — preferences-schema.yaml 字段升级
  - **A4b (新)** — preference_lint detector 实现，复用 regex detector 的实现模式（policy/detectors/regex.ts）
  - **A4c (新)** — dev SKILL P1/P2 在生成代码前预读 preferences 并通过 detector 自检
- A4 总工作量从"30 行"修正为 2 周。

**结论**：方向不变，但工作量被严重低估。

---

### A5 design-sheet contracts[] 结构化

**假设**：未来工作。

**挑战**（已被 [inventory.md](./inventory.md) §9 验证）：
- `_shared/artifact-schema.yaml` lines 61-69 的 `verification_plan.contracts[]` **已经存在**。
- 真正的待办是：
  1. think SKILL 在 P2 路径**强制要求**填 contracts（而非"建议"）
  2. write-artifact handler 在写 design-sheet 时校验 contracts 数组非空且字段完整
  3. dev SKILL 读取 contracts 后产出对应测试断言（这跨入 B 阶段）

**修正建议**：
- A5 重写为"contracts 字段的强制化"——schema 已就位，缺的是 SKILL 文字硬性化 + write-artifact 校验。

**结论**：A5 应改名为"contracts 强制化"，避免"已完成的工作被误以为未完成"。

---

### A6 dev SKILL 硬性化 quality_gates

**假设**：改 SKILL.md 文字即可。

**挑战**：
- SKILL.md 是 Markdown 协议，LLM 读了不一定执行。"硬性化"必须落到 write-artifact 校验层。
- 具体：dev-report schema 需要新增 `quality_gates_result` 必填字段（pass/fail + failure list）；write-artifact 在写 dev-report 时强制读这个字段并校验。
- 这是 schema + handler 双侧改动，不是单改 SKILL.md。

**修正建议**：
- A6 拆为：
  - **A6a** — artifact-schema.yaml 给 delivery_report 加 `quality_gates_result` 必填字段
  - **A6b** — write-artifact.ts 加该字段的 collectContentIssues 校验
  - **A6c** — dev SKILL.md 文字升级为"必须在交付前 emit quality_gates_result"

**结论**：原 A6 的"改 SKILL.md 文字"是必要不充分的；需要 schema + handler 双侧硬保障。

---

### A7 diff_chunks handler

**假设**：Phase B/C 共同前置。

**挑战**：
- "风险加权"的权重表来自哪里？硬编码进 handler，还是配置文件？如果硬编码，未来扩展（如 Rust/Java 项目）需改代码；如果配置文件，要设计 schema。
- 大仓库一次 PR 可能有 50+ 文件、200+ hunk。"按 hunk 切"返回的数据结构需要分页 / 流式吗？

**修正建议**：
- 权重表放 `_shared/risk-weights.yaml` 单独配置文件，初始 5 类（type 签名 / SQL / 认证 / API / 删除 public）
- handler output 加 `total_chunks` 与 `chunks` 字段（已在 mcp-tools.yaml lines 188-192 声明）；提供 `top_n` 参数支持调用方按 risk score 取前 N 个 hunk

**结论**：方向正确但 schema 设计需细化。

---

## Phase B · 测试充分性引擎 — 压力测试

### B1 run_quality_gates 加 coverage 子字段

**假设**：vitest v8 coverage 输出结构稳定。

**挑战**：
- v8 输出格式 across vitest 版本有差异；从 vitest 4.x 迁到 5.x 时格式可能变。
- 用户项目可能用 jest / mocha / pytest——这些工具的 coverage 输出格式各不相同。
- per-contract coverage 需要 source map 关联 → contract test_file_hint 字段；如果 hint 写错，无法关联。

**修正建议**：
- B1 第一版只做 per-file coverage（统一为 lcov 中间格式，多工具通过 adapter）。
- per-contract coverage 推到 D（依赖更稳定的 contract↔test 映射机制）。

**结论**：B1 必须降级为 per-file 起步，否则跨工具兼容会拖死整个 Phase。

---

### B2 `/r-augment` skill

**假设**：augment 能独立于 dev 运行。

**挑战**：
- augment 需要"已交付的代码 + design-sheet contracts"作为输入。如果 dev 还在进行（用户分两步走），augment 怎么知道何时启动？
- 用户记得手动 `/r-augment` 吗？还是 dev 完成后由 dev SKILL 主动建议？两种 UX 完全不同。
- 现在 marketplace.json 已 ghost 注册——证明设计阶段未完成就被对外暴露。

**修正建议**：
- augment 应在 dev 的 done 事件后**由 dev SKILL P2 路径主动建议**（不强制触发，给用户决定权）。
- 在 marketplace 显示 augment 之前，先把 skills/augment/SKILL.md 骨架建好（哪怕只是 TODO）。
- augment 的输入 schema 显式声明 `design_sheet_path` + `dev_report_path` 必填——逼迫调用方有明确的依赖。

**结论**：augment 的 UX 设计不能省。建议改为 dev SKILL 主动建议触发。

---

### B3 contract_coverage detector

**假设**：消费 A5 contracts × A7 hunk × B1 coverage 即可。

**挑战**：
- 依赖三个前置：contracts 强制化 + diff_chunks + coverage 字段。任一失败则 B3 无法落地。
- "每个 contract ≥ 1 个测试断言"的判定逻辑——什么算"断言"？test_file_hint 路径下任意 `expect()/assert()`？还是必须显式提及 contract id？后者要求强约定。

**修正建议**：
- B3 增加 `contract id ↔ assertion 关联` 的约定：contracts 字段加 `assertion_marker` 子字段（自由字符串，作为测试断言的搜索关键字）
- detector 检测时在 test_file_hint 路径下 grep assertion_marker
- 这把"语义判定"变成"机械匹配"，避免 false negative

**结论**：方向对但判定逻辑需要新增"关联标记"字段。

---

### B4 miner --promote 半自动 promotion

**假设**：工作量低（在已有 miner 上加命令）。

**挑战**：
- "半自动"要求 review 阶段产生**结构化** violation 作为输入（C4 的工作）。这个依赖往后推了 3 个月。
- 没有结构化 violation 时，miner 只能 promote `mining-sheet` 报告里的自然语言项，需要再过一道 LLM 加工——又把不确定性引回来了。

**修正建议**：
- B4 延后到 C4 完成之后（M7-M8 之间），或者
- B4 第一版直接 promote `mining-sheet` 中由人手动 cherry-pick 的 markdown 行，不做语义提取（朴素方案）

**结论**：B4 的依赖链跨 phase；按当前顺序会做空。

---

## Phase C · 工业级 Review 缩放 — 压力测试

### C1 review 三方比对

**假设**：缺一不可的强约束。

**挑战**：方向无问题，但要求 design-sheet / dev-report / assurance-sheet 三者都有结构化字段：
- design-sheet 已有 contracts[]（A5 完成）
- dev-report 待加 quality_gates_result（A6b）
- assurance-sheet 待加 contract_verdict 关联 contracts → 待补 schema

**修正建议**：C1 前要新增 assurance-sheet schema 升级（contract_verdict 数组），否则三方比对无字段可比。

**结论**：补一个隐性前置。

---

### C2 sibling span + partial assurance 合并

**假设**：只做协议基础设施。

**挑战**：
- "只做协议层不做实际 wiring"会产生**无人消费的协议**——花了 Phase C 1/4 的预算建一个等 D 阶段才用得上的能力。
- 异构模型 wiring 何时发生？v2 ROADMAP 没有明确目标客户/时间。

**修正建议**：
- C2 降级为"协议层小步快走"：先只支持 partial assurance 合并的字段定义，不实现 sibling span 创建逻辑。
- 等真有 use case（第一个异构模型集成请求）再做完整版本。

**结论**：C2 有过度设计风险，建议小步走。

---

### C3 hot-rules 离线统计

**假设**：替代 cross_pr_echo 即可。

**挑战**：
- `ritsu doctor --hot-rules` 扫 .ritsu/ctx-*.jsonl 30 天的 violation_detected 事件——前提是 C4（review 强制 emit violation_detected）已经持续运行了 30 天。
- 在 C4 上线前的 30 天窗口期，hot-rules 输出会全是空——这会让用户认为功能坏了。

**修正建议**：
- hot-rules 加 `--since` 自定义起始时间参数
- 当 30 天窗口内 violation 事件少于 N 条时，加输出说明"数据不足，建议持续运行 ≥ 30 天"

**结论**：UX 细节缺失。

---

### C4 violation_detected 强制留痕

**假设**：review SKILL 加一行 emit_event 即可。

**挑战**：
- ctx-event-schema.json 的 violation 字段（lines 77-85）已存在——schema 就位
- 缺的是 review SKILL 文字以及 evaluatePolicies 调用方在拦截后是否真的调用 emit_event
- 当前 write-artifact 拦截到 violation 时只 errorResult 返回，没有同时 emit_event(violation_detected)

**修正建议**：
- C4 拆为：
  - **C4a** — write-artifact 拦截 violation 时强制 emit_event(violation_detected)（schema 已就位，只缺调用）
  - **C4b** — review SKILL 文字硬性化

**结论**：C4 实际是 handler 改动，不是 SKILL 改动。

---

## Phase D · 闭环固化 — 压力测试

### D1 AST detector

**假设**：用 ts-morph 落地 TS 专属。

**挑战**：
- 项目本身是 TS，但**用户的项目可能是任意语言**（Python、Go、Rust...）。AP-2 unknown identifiers 不是 TS-only 问题。
- ts-morph 只覆盖 TS，意味着 D1 对非 TS 用户毫无价值。

**修正建议**：
- D1 改用 **tree-sitter**（支持多语言 grammar），代价是依赖更重 + 复杂度更高
- 或者：D1 显式声明"仅 TS 项目"，并在 AGENTS.md 中加 `ast_detector_enabled: false` 自动 fallback

**结论**：D1 的语言选择是战略决策，影响 R-02（实拦截率）能否在非 TS 项目里上升。

---

### D2 / D3 GitHub App

**假设**：12 个月内的现实目标。

**挑战**：
- GitHub App 需要 OAuth 应用注册、webhook handler、独立部署、运维成本。**这违反 ROADMAP §1.3 的反指标"需要绑账号 / SaaS / 订阅"**。
- App 的 "ritsu-app.example.com" 域名一旦部署，就有人来询问"我自托管能用吗"——会变成支持负担。

**修正建议**：
- D2/D3 改为 **GitHub Action**（CI 内运行的 yaml workflow，不是常驻服务）
- Action 复用现有的 `ritsu sync push/pull` + CLI；用户在自己的 `.github/workflows/` 加一段就能用
- 避免服务化、避免账号绑定、保持 local-first

**结论**：原 D2/D3 方向**自相矛盾**——既要 git-native 又要 SaaS 化的 GitHub App。必须改 Action。

---

### D4 doctor --health 三指标

**假设**：detector 命中率 / miner promote 率 / coverage 趋势是合适指标。

**挑战**：
- "detector 命中率"如果上升，是好事（拦截更多）还是坏事（项目质量在下降）？需要解释口径。
- "miner promote 率"如果团队不用 mine 命令，分母为 0。
- "coverage 趋势"依赖 B1 落地，且需要历史快照——D4 之前没人存历史，无法计算"趋势"。

**修正建议**：
- 每个指标补充解释口径（是绝对值还是相对值？是越高越好还是有合理区间？）
- doctor --health 加历史快照写入（写到 `.ritsu/health-snapshots.jsonl`），否则首次跑没有"趋势"
- 增加第 4 个指标"P2 任务的三件套完成率"（design + dev + assurance 都齐全的比例），作为 process 健康度指标

**结论**：指标设计需要再打磨；当前定义易被误读。

---

## 汇总：跨 Phase 的隐性依赖

```
A5 contracts 强制化 ─┬─► A6 dev-report quality_gates 字段 ─┐
                    │                                       │
                    └─► B3 contract_coverage detector ──────┤
                                                            ├──► C1 三方比对
                                                            │
A4b preference_lint ─┬─► C4a write-artifact emit violation ─┤
                    │                                       │
                    └─► B4 miner promote 信号源 ────────────┘
                                                            │
B1 coverage (per-file) ────► D4 coverage 趋势 ──────────────┘
                                                            │
                                                    D2/D3 GitHub Action
                                                            │
                                                       v6.0.0
```

**关键发现**：原 v2 ROADMAP 把 A 阶段画为 7 个并行任务；但 A5 → A6 → B3 → C1 形成一条**核心契约链**，任何一环延期都会传导到 C 阶段。

---

## 关键修正项清单（按 Phase 汇总）

| Phase | 原任务 | 修正 |
|---|---|---|
| A | A1 detector 实现 | 加 confidence 字段；scope_diff 第一版只做 exact + 目录前缀 |
| A | A4 schema 结构化 | 拆为 A4a (已完成) + A4b (detector) + A4c (SKILL 集成) |
| A | A5 contracts | 改名为"contracts 强制化"（schema 已就位）|
| A | A6 SKILL 硬性化 | 拆为 schema (A6a) + handler 校验 (A6b) + SKILL 文字 (A6c) |
| A | A7 diff_chunks | 权重表外置为 `_shared/risk-weights.yaml` |
| B | B1 coverage | 降级为 per-file（多工具 lcov adapter）；per-contract 推到 D |
| B | B2 augment | 改为 dev SKILL P2 主动建议；建骨架避免 ghost |
| B | B3 contract_coverage | contracts 加 `assertion_marker` 字段配合 detector |
| B | B4 miner promote | 延后到 C4a 之后 |
| C | C1 三方比对 | 前置补 assurance-sheet schema 升级 |
| C | C2 sibling span | 降级为字段定义，不做创建逻辑 |
| C | C3 hot-rules | 加 `--since` + 数据不足提示 |
| C | C4 violation 留痕 | 拆为 handler 强制 emit (C4a) + SKILL 文字 (C4b) |
| D | D1 AST | tree-sitter vs ts-morph 战略决策 |
| D | D2/D3 GitHub App | 改为 GitHub Action（避免反指标） |
| D | D4 三指标 | 补口径解释 + 历史快照写入 |

---

## 如何使用本文档

1. **执行前阅读**：每个 Phase 启动前，对应章节中的"修正建议"必须明确接受或拒绝（拒绝需在 design-sheet 中写明理由）
2. **执行中复审**：每 2 周对照本表检查实际工作量是否符合修正后估计
3. **执行后归档**：Phase 完成后，把本文中相应章节标注 ✅，记录最终选择与原因
4. **风险联动**：本文档识别的隐性问题已纳入 [risk-register.md](./risk-register.md)
