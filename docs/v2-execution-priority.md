# v2 ROADMAP 执行攻坚顺序

> **生成日期**：2026-05-15
> **目的**：基于 [inventory.md](./inventory.md) §9 已落地交叉的发现，重新排列 v2 ROADMAP 的任务执行顺序——优先收割"schema 已通但消费侧缺失"的低成本高 ROI 项
> **基准文档**：[ROADMAP.md](./ROADMAP.md) v2 + [v2-stress-test.md](./v2-stress-test.md) 的修正建议
> **更新策略**：每完成一个 batch 后回顾本表并重排

---

## 1. 核心洞察

v2 ROADMAP 假设所有任务都从零开始——但盘点发现：

| 已落地（占了原工作量的 30%） | 缺消费侧（真正瓶颈） |
|---|---|
| `verification_plan.contracts[]` schema | think SKILL 没强制要求填 |
| `preferences match_regex/forbid_lib/require_call` schema | 没有 detector 消费 |
| `ctx-event-schema cost/violation` 字段 | 调用方很少传 cost；violation 几乎不 emit |
| `status: violation_detected` 枚举 | review SKILL 没强制 emit |
| `mcp-tools.yaml output_schema` 全部声明 | 默认不校验（需 STRICT 环境变量） |

**结论**：v2 当前阶段最高 ROI 不是"加新功能"，而是"给已落地的字段接线"——成本低、风险低、把宣称能力变成真实能力。

---

## 2. 重排后的执行序列

### Batch 1 · 接线快速 wins（M1, 1 个月）

**目标**：把已落地的 schema 字段接通消费侧，**实拦截率从 17% 提到 40%+**。

| 顺序 | 任务 | 来源 v2 | 工作量 | 收益 |
|---|---|---|---|---|
| 1.1 | write-artifact 拦截 violation 时强制 emit_event(violation_detected) | C4a (拆分) | 0.5 周 | 给 miner 持续高质量信号源 |
| 1.2 | think SKILL P2 强制要求填 contracts；write-artifact 校验 design-sheet.contracts 非空 | A5 (改) | 1 周 | 契约链路第一环通 |
| 1.3 | dev-report schema 加 `quality_gates_result` 必填；write-artifact 校验；dev SKILL 文字硬性化 | A6a/b/c | 1.5 周 | 生成端→验收端信息通畅 |
| 1.4 | preference_lint detector 实现（复用 regex detector 模式）；dev SKILL P1/P2 加预读 | A4b/c | 1.5 周 | 偏好真正参与拦截 |

**Batch 1 DoD**：
- 实拦截率从 17% 升至 ≥ 40%（新增 preference 命中 + scope_diff 占位移除）
- Ritsu 自跑 `/r-dev` 后 dev-report 必含 quality_gates_result 字段
- 触发任意 violation 时 `.ritsu/ctx-*.jsonl` 必有 violation_detected 事件
- think SKILL 写出的 design-sheet 必含 ≥ 1 个 contract

---

### Batch 2 · detector 占位符消化（M2, 1 个月）

**目标**：消化"看似有拦截、实则空壳"的假阳健康度。

| 顺序 | 任务 | 来源 v2 | 工作量 | 收益 |
|---|---|---|---|---|
| 2.1 | scope-diff detector 第一版（exact + 目录前缀, minimatch）；加 `confidence` 字段 | A1 (半) | 1.5 周 | AP-4 真拦截 |
| 2.2 | cross-file detector 第一版（仅 4 类指定文件）；自动触发 version 漂移检测 | A1 (半) | 1.5 周 | R-2 真拦截；解决 R-14 版本漂移 |
| 2.3 | policy/index.ts detector 注册表防呆：未注册 type 抛错 | A2 | 0.5 周 | 修 AST 静默失败 |
| 2.4 | runtime/dist/ 退 git（一次性 `git rm -r --cached`）+ 版本号 SoT 统一 | A3 | 0.5 周 | 解决 R-13 + R-14 |

**Batch 2 DoD**：
- 实拦截率升至 ≥ 60%（新增 scope_diff + cross_file 真实现）
- `package.json` 版本与 AGENTS.md / marketplace 一致
- 故意写 type: ast 的 anti-pattern，server 启动报错

---

### Batch 3 · 测试与可观测性兜底（M3, 1 个月）

**目标**：补齐 policy 引擎测试空白；加 output_schema 默认强制。

| 顺序 | 任务 | 来源 | 工作量 | 收益 |
|---|---|---|---|---|
| 3.1 | policy 引擎单元测试（regex / loader / evaluatePolicies 调度） | R-05 / R-18 | 1 周 | 闭环 R-05 + R-18 |
| 3.2 | policy/loader.ts 加 mtime-based 缓存 | R-06 | 0.5 周 | 闭环 R-06 |
| 3.3 | output_schema 默认强制（dev 环境 throw, prod warn）；可通过 `RITSU_STRICT_OUTPUT=0` 关闭 | R-04 | 1 周 | 14 个 tool 的协议真生效 |
| 3.4 | span 三件套 + get-diff + policy-check 补 handler 测试 | （独立） | 1.5 周 | handler 覆盖从 64% 提到 100% |

**Batch 3 DoD**：
- handler 测试覆盖 100%
- policy 引擎专项测试 ≥ 10 个用例
- `RITSU_STRICT_OUTPUT` 默认开（dev 环境），所有 tool 输出符合声明的 output_schema

→ **A 阶段（Batch 1-3）完成，发布 v5.4.0**。比原 v2 时间表少 0 个月，因为 Batch 1 收割了已落地工作。

---

### Batch 4 · diff_chunks + augment 骨架（M4, 1 个月）

**目标**：B 阶段前置基础设施。

| 顺序 | 任务 | 来源 | 工作量 | 收益 |
|---|---|---|---|---|
| 4.1 | `_shared/risk-weights.yaml`（5 类初始权重） | A7 (前置) | 0.5 周 | 权重外置 |
| 4.2 | diff_chunks handler 实现（hunk 解析 + 权重打分 + top_n） | A7 | 2 周 | B/C 共同前置 |
| 4.3 | skills/augment/SKILL.md 骨架（消除 R-03 ghost） | B2 (前置) | 0.5 周 | 闭环 R-03 |
| 4.4 | dev SKILL P2 路径加"建议 /r-augment"出口 | B2 (UX) | 1 周 | augment 触发链路 |

**Batch 4 DoD**：
- `ritsu_diff_chunks` 跑通：给 100 个 hunk 的 PR 切出 top 20 high-risk
- `skills/augment/SKILL.md` 文件存在，marketplace 不再 ghost
- dev SKILL P2 完成后建议 `/r-augment`（不强制）

---

### Batch 5 · 测试充分性引擎（M5-M6, 2 个月）

| 顺序 | 任务 | 来源 | 工作量 | 收益 |
|---|---|---|---|---|
| 5.1 | run_quality_gates 加 per-file coverage（lcov adapter）| B1 (降级) | 1.5 周 | 覆盖率字段就位 |
| 5.2 | augment SKILL 完整实现：读 contracts × coverage gap → 提议补测 | B2 | 2 周 | 对抗式补测 |
| 5.3 | contracts 加 `assertion_marker` 字段；artifact-templates 同步 | B3 (前置) | 0.5 周 | 关联标记 |
| 5.4 | contract_coverage detector（消费 contracts × diff_chunks × coverage）| B3 | 2 周 | 契约级测试缺口拦截 |
| 5.5 | miner --report / --promote 半自动闭环 | B4 | 1 周 | 偏好 promotion |

**Batch 5 DoD**：
- 写 2-contract design-sheet + 1 个测试 → contract_coverage 报缺
- `ritsu mine --report` 出候选 → `--promote` 写 preferences
- 仓库 10 个 PR 每个 contract ≥ 1 个断言

→ **B 阶段完成，发布 v5.5.0**。

---

### Batch 6 · 工业级 Review 缩放（M7-M8, 2 个月）

| 顺序 | 任务 | 来源 | 工作量 | 收益 |
|---|---|---|---|---|
| 6.1 | assurance-sheet schema 加 `contract_verdict[]` 数组字段 | C1 前置 | 0.5 周 | 三方比对的字段就位 |
| 6.2 | review SKILL P2 强制 join_trace 三方比对（design ↔ dev ↔ assurance） | C1 | 2 周 | 证据链强制 |
| 6.3 | trace 协议层：partial assurance 合并字段定义（不实现 sibling 创建） | C2 (降级) | 1 周 | 留出未来扩展位 |
| 6.4 | `ritsu doctor --hot-rules` + `--since` 参数 + 数据不足提示 | C3 | 1 周 | 离线统计 |
| 6.5 | review SKILL.md 文字硬性化 violation 留痕 | C4b | 0.5 周 | 信号闭环 |

**Batch 6 DoD**：
- 1k+ LoC PR 走 `/r-review` Critical，token < 30k（依赖 diff_chunks 切片）
- review 缺任一证据链则 verdict = `needs_revision`
- `ritsu doctor --hot-rules` 输出 top 5

→ **C 阶段完成，发布 v5.6.0**（已 proposed 在 CHANGELOG）。

---

### Batch 7 · 闭环固化（M9-M12, 4 个月）

| 顺序 | 任务 | 来源 | 工作量 | 收益 |
|---|---|---|---|---|
| 7.1 | AST detector 战略决策：tree-sitter 还是 ts-morph？写技术 RFC | D1 (前置) | 1 周 | 决策点显式化 |
| 7.2 | AST detector 实现（按 7.1 选择） | D1 | 4 周 | 多语言（或 TS 专项）兜底 |
| 7.3 | GitHub Action（不是 App）：CI 内自动渲染三件套对账 | D2/D3 (改) | 4 周 | 团队层、不违反反指标 |
| 7.4 | doctor --health 三指标 + 历史快照 + 口径文档 + 第 4 指标（三件套完成率） | D4 (改) | 2 周 | 客观度量 |

**Batch 7 DoD**：
- AST detector 至少覆盖 AP-2 unknown identifiers
- GitHub Action 在测试仓 PR 上自动评论三件套对账
- `ritsu doctor --health` 输出 4 指标 + 历史趋势

→ **D 阶段完成，发布 v6.0.0**。

---

### Batch 8 · 跨 Agent 协作协议（M13-M14, 2 个月）

**目标**：实现 [RFC-002](./rfc/003-multi-agent-collaboration.md) 中集——跨进程 + 签名 + lease + task claim。
**对应**：[ROADMAP](./ROADMAP.md) Phase E。

| 顺序 | 任务 | 来源 RFC-002 | 工作量 | 收益 |
|---|---|---|---|---|
| 8.1 | `RITSU_TRACE_PARENT` 协议 + `inject_trace_context` / `extract_trace_context` handler | E1 | 1 周 | 跨进程 trace 串联可用 |
| 8.2 | HMAC 签名 schema + `verify_trace` handler + CLI `trace --verify` + `init-key` | E2 | 2 周 | 事件可信、伪造可检测 |
| 8.3 | File lease 三件套（`claim_file` / `release_file` / `list_leases`）+ write-artifact 集成 + close_span auto-release | E3 | 1.5 周 | 并行 agent 不冲突 |
| 8.4 | coordination-sheet YAML frontmatter 升级 + artifact-schema.yaml 强约束 + write-artifact 校验 | E4 | 1 周 | 协调单机器可读 |
| 8.5 | 任务 claim 协议（`claim_task` / `complete_task` / `list_pending_tasks`）+ CLI `task ...` 子命令 | E5 | 1.5 周 | 任务可机器领取 |
| 8.6 | 跨进程 demo + 集成测试（三个异构 shell 模拟三 agent 协作产 PR） | E6 | 1 周 | DoD 验证闭环 |

**Batch 8 DoD**：
- 三个异构 shell 跨进程协作完成一个真实 PR
- `ritsu trace --verify <trace_id>` 全绿
- 并行 claim 同一 task / file 必返 conflict
- 故意篡改 ctx-*.jsonl 一行能被 `--verify` 抓出
- coordination-sheet 含 frontmatter 时 task claim API 可用；不含时降级为纯人读且 API 明确报错

→ **E 阶段完成，发布 v6.1.0**。

---

### Batch 9 · 高阶协调与可观测（M15-M17, 2.5 个月）

**目标**：实现 [RFC-003](./rfc/004-advanced-coordination.md) 6 项——capability + budget + OTel + ed25519 + dir-lease + metrics。
**对应**：[ROADMAP](./ROADMAP.md) Phase F。

| 顺序 | 任务 | 来源 RFC-003 | 工作量 | 收益 |
|---|---|---|---|---|
| 9.1 | Agent Capability Registry：`.ritsu/agents/<id>.yaml` schema + `register_capability` / `query_capabilities` + CLI `agent ...` | F1 | 1.5 周 | planner 可查询 agent 能力 |
| 9.2 | Budget Tracking：coordination-sheet frontmatter 加 budget 字段 + `check_budget` / `reserve_budget` / `release_reservation` + close_span 自动结算 + `budget_warn` / `budget_exhausted` 事件 | F2 | 2 周 | task 级 token/cost 预算 |
| 9.3 | OTel TRACEPARENT 双向 import + open_span fallback 解析 + `external_trace_id` 字段 | F3 | 1 周 | 既有 OTel 上下文可串入 |
| 9.4 | OTel export：CLI `trace --otel <id> --format <jaeger\|zipkin\|otlp-json>` | F4 | 1.5 周 | Ritsu trace 可视化进 Jaeger |
| 9.5 | ed25519 升级：`init-key --algo` + signatures[] schema + `.ritsu/team-trust/` + `trust-policy.yaml` + `trust revoke` CLI | F5 | 2 周 | 团队层非对称信任 |
| 9.6 | Directory-level lease：path 支持 `/` 结尾目录前缀 + 冲突规则实现 + 测试 | F6 | 1 周 | 大范围 claim 可用 |
| 9.7 | Metrics CLI：`doctor --metrics --since N --format json` + `.ritsu/health-snapshots.jsonl` 历史快照 | F7 | 1.5 周 | 全维度可观测 |
| 9.8 | 集成测试 + 多 OTel 后端 demo + 多 agent 真实 PR 闭环 | F8 | 1 周 | DoD 验证 |

**Batch 9 DoD**：
- 一个真实多 agent PR 走完整链路：capability query → task claim with budget → 跨进程协作（v6.1）→ ed25519 签名 → OTel 导出到 Jaeger 可视化
- `ritsu doctor --metrics --since 30d` 在 Ritsu 自身仓库出 7 维统计无空指标
- 模型升级（Opus 4.7 → 4.8）只需新增一份 `.ritsu/agents/claude-opus-4-8.yaml`，无代码改动
- `ritsu trust revoke` 后旧事件 verify 必报 invalid

→ **F 阶段完成，发布 v6.2.0**。

---

## 3. 时间线对比

| 维度 | 原 v2 | 重排后 |
|---|---|---|
| Phase A | 3 个月 | 3 个月（拆为 3 batch） |
| Phase B | 3 个月 | 2 个月 + Batch 4 共享 | 
| Phase C | 2 个月 | 2 个月 |
| Phase D | 4 个月 | 4 个月 |
| **总计** | 12 个月 | **11 个月**（Batch 1 收割已落地工作节省 1 个月） |

---

## 4. 关键里程碑

| 时间 | 里程碑 | 实拦截率目标 | 版本 |
|---|---|---|---|
| 完成 Batch 1 (M1) | 已落地 schema 全部接线 | 40% | v5.3.x 内部 |
| 完成 Batch 2 (M2) | scope_diff / cross_file 真拦截 | 60% | v5.3.x 内部 |
| 完成 Batch 3 (M3) | policy 测试 + output strict | 60%（拦截率不动，但可信度上升） | **v5.4.0 发布** |
| 完成 Batch 5 (M6) | 契约覆盖 + augment + miner promote | 65% | **v5.5.0 发布** |
| 完成 Batch 6 (M8) | review 三方比对 + hot-rules | 70% | **v5.6.0 发布** |
| 完成 Batch 7 (M12) | AST + GitHub Action + 健康指标 | 80% | **v6.0.0 发布** |

---

## 5. 给执行者的判断准则

每个 Batch 开始前确认：
- ☐ 该 Batch 关联的 [risk-register.md](./risk-register.md) 风险已知
- ☐ [v2-stress-test.md](./v2-stress-test.md) 中相应章节的修正建议已采纳或显式拒绝
- ☐ 该 Batch DoD 中的每一条都能被自动化验证（不能是"看上去 OK"）
- ☐ 完成后 Ritsu 自身能用更新后的能力跑通自己的 `/r-review`（dogfooding）

如果以上任何一条无法满足，回到 [v2-stress-test.md](./v2-stress-test.md) 重新评估方案，或在 `decision_log.md`（待建）中记录妥协。
