---
name: think
version: "3.8.0"
description: "Ritsu 领域自适应需求评审与架构设计。强制拆分为评审阶段和设计阶段，输出防腐 Handoff 文件。"
when_to_use: "/r-think, 设计方案, 怎么做, 要不要做, 分析一下, 看看这个 PRD"
total_steps: 7
fast_mode:
  skip_steps: [2, 3]
  skip_artifacts: false
  self_test: null
  description: "跳过多维轰炸(2)和事前验尸(3)，直接进入架构设计+Handoff输出，仍写产物文件"
hard_constraints:
  - id: HC-1
    rule: "Phase A 完成后必须强制停止，收到用户确认后才进入 Phase B"
    severity: FATAL
  - id: HC-2
    rule: "ref AP-6: Handoff 文件不得包含占位符"
    severity: FATAL
  - id: HC-3
    rule: "文件名必须使用 kebab-slug 规则，不得使用中文或空格"
    severity: WARN
  - id: HC-4
    rule: "Cost-Aware Planning：Phase B 推荐方案必须给出 Complexity Score（变更规模/侵入度/运行时开销）。若侵入度 > 7，必须给出至少两个备选方案，并解释为什么不选更稳健的那个"
    severity: FATAL
---

# Think: 领域自适应需求评审与架构设计

**触发条件**：用户输入 `/r-think`。

## Phase A — 需求评审会

### A1. 领域解析

> 引用 `_shared/skill-common-steps.md` Step 1

若本次 `/r-think` 是由熔断引导（例如来自 review 连续 FAIL），则在进入 A2 前追加一个“输入对账”步骤：

- 调用 `ritsu_list_artifacts`（type=review-stamp）获取最近一条 Review Stamp
- 用 `ritsu_exec` 读取该文件内容（只读）
- 若存在 `## 熔断反馈（给 /r-think）` 小节，则将其作为本次评审会的优先输入，先回答其中“需要升维确认的问题”，再进入 A2

### A2. 多维轰炸（基于领域）

`[Step A1 Complete]` 后进入 A2。

⚠️ **输出规则**：每个问题必须附带至少 1 个推荐方案（标注推荐/备选），禁止只抛问题不给解法。

按当前领域已加载的 `attack_vectors` 逐条审查（`domains/_base.yaml` + `domains/{domain}.yaml`）。对每条 attack_vector 的 `check` 字段提出问题 + 推荐方案 + 备选方案。

> LLM 必须根据当前项目的技术栈和约束条件**调整方案**，禁止原样照搬 domain YAML 中的通用建议。若项目已有成熟方案，标注"已有方案"并跳过。

### A3. 事前验尸报告 (Pre-mortem Matrix)

`[Step A2 Complete]` 后进入 A3。

在进入设计前，强制 AI 扮演"破坏者"，对当前需求输出一个异常路径矩阵，**每行必须填写推荐缓解方案**，禁止留空：
| 异常场景 | 表现与后果 | 推荐缓解方案 | 备选方案 |
|---------|-----------|-------------|----------|
| **并发超载** | 流量 10x 涌入时，哪个节点最先塌掉？ | {限流/削峰/扩缩容} | {降级/熔断} |
| **持久化失败** | 数据库断连/脏数据写入时，如何回滚？ | {事务回滚/补偿} | {WAL+重放} |
| **黑客注入/重放** | 如果攻击者篡改参数，系统如何防御？ | {参数校验+签名} | {Rate Limit+Nonce} |
| **异步中断** | 任务执行到一半断网/宕机，状态如何恢复？ | {状态机+幂等重试} | {Checkpoint+恢复} |

> LLM 必须根据当前需求填充具体方案，禁止输出空行或"待定"。

### A4. 输出漏洞清单并强制停止

`[Step A3 Complete]` 后进入 A4。

```markdown
## ⚠️ 需求漏洞清单 (Phase A)

| #   | 漏洞       | 风险 | 推荐方案   | 备选方案 | 需确认 |
| --- | ---------- | ---- | ---------- | -------- | ------ |
| 1   | {漏洞描述} | 高   | {具体方案} | {备选}   | ✅/❌  |

---

**请逐条确认：采用推荐方案 / 切换备选方案 / 自定义方案。**
```

向用户展示漏洞清单，要求逐条确认：采用推荐方案 / 切换备选方案 / 自定义方案。**收到确认前，不进入 Phase B。**

---

## Phase B — 架构设计与 Handoff 输出

### B1. 契约优先

`[Phase B Started]` 用户确认后进入。

先锁定边界契约（引用 `_shared/artifact-schema.yaml` Schema 1 Contract 字段），再构思实现逻辑。

### B2. 多方案博弈

`[Step B1 Complete]` 后进入 B2。

提供 2 套方案，使用强制对比表格，并询问用户选择：
| 维度 | 方案 A | 方案 B |
|------|-------|-------|
| 核心依赖 | | |
| 实现复杂度（1-5）| | |
| 运维成本 | | |
| 可扩展性 | | |
| 推荐原因 | | |

在输出推荐方案前，必须附加 Complexity Score（动态代价评估）：

```
Complexity Score（1-10）
- 变更规模(LoC/文件数): {1-10} — 估计 {files} 文件 / {loc} 行
- 架构侵入度: {1-10} — 影响范围（模块边界/公共接口/数据模型/部署链路）
- 运行时开销: {1-10} — CPU/内存/IO/冷启动/缓存命中

判定：
- 若“架构侵入度” > 7：必须提供至少 2 个备选方案（其中至少 1 个是更稳健/低侵入），并解释为何不选它
```

首推方案必须通过三项攻击测试：

1. **宕机**：外部依赖 502 时的降级方案（不接受"暂无"）
2. **10x**：流量放大 10 倍最先撑爆的点及缓解措施
3. **回滚**：逐步骤列出回滚指令 + 脏数据恢复方案

### B3. Handoff 文件输出

`[Step B2 Complete]` 后进入 B3。

命名规则：需求描述前 3 个有效英文关键词 → kebab-case（如 `handoff-user-login-flow.md`）

调用 **`ritsu_write_artifact`**（type=handoff）写入，按以下骨架构造内容：

```markdown
# {需求标题}

## 边界与依赖

- **目标范围 (In Scope)**: {列出}
- **Out of Scope**: {列出，禁止模糊}
- **新增依赖**: {名称/版本/License/体积 或 '无'}

## 核心契约 (Contract)

{按 domain 条件选择：backend→api_contract+data_model / frontend→component_contract / fullstack→两者}

## 攻击测试防线

- **宕机响应**: {外部依赖 502 降级方案}
- **10x 瓶颈**: {流量放大 10 倍最先撑爆的点及缓解措施}
- **回滚步骤**: {逐步骤列出回滚指令}

## 实施清单

- [ ] `{文件路径}`: {主干逻辑描述，精确到函数/组件级别}
```

写入完成后更新 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=think, artifact=.ritsu/handoff-{slug}.md）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=think）
