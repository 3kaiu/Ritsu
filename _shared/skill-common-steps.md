# Skill 公共步骤模板 v3.6.0

> 所有 SKILL.md 中重复出现的三个步骤，统一引用此模板，禁止各自重写。
> 引用方式：`> 引用 _shared/skill-common-steps.md Step N`
> ⚠️ 此文件已内联关键协议，LLM 读取此单文件即可执行，无需再跳转其他文件。

---

## Step 0: 复杂度分级 (Complexity Grading)

每个技能在执行前，必须先判断任务复杂度，选择对应的执行级别：

| 级别        | 条件                           | 流程简化                                                                                          |
| ----------- | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| **L0 微调** | ≤10 行变更，单文件，无架构影响 | 跳过 think/review，dev 直接执行 + `ritsu_run_quality_gates` 自测                                  |
| **L1 常规** | ≤50 行变更，1-3 文件           | think 精简版（只输出实施清单，不做多维轰炸/事前验尸），review 快速版（只跑 Hard Stop + 质量门禁） |
| **L2 标准** | >50 行或涉及架构变更           | 完整流程（当前 SKILL.md 定义的完整步骤）                                                          |

**分级依据**（按优先级）：

1. 用户提供的手动指定（如 `/r-dev --L0`）
2. 变更文件数 + 预估变更行数（通过 `ritsu_get_changed_files` 获取）
3. handoff 实施清单项数（≤1 项→L0，≤3 项→L1，>3 项→L2）

**L0 快速通道执行规范**：

- 只调用 `ritsu_emit_event(event_type=started)` + `ritsu_emit_event(event_type=done)` 两个事件
- 直接调用 `ritsu_run_quality_gates` 验证
- 输出精简交付摘要（涉及文件 + Lint/Test 结果）
- 不写 handoff/diagnosis/review-stamp 产物

**L1 常规通道执行规范**：

- think 只输出实施清单 + 边界契约，跳过多维轰炸（A2）和事前验尸（A3）
- review 跳过领域语义审查（Step 4），只跑 Hard Stop + `ritsu_run_quality_gates`
- 事件写入：started + artifact_written（如有产物）+ done/failed

---

## Step 1: 领域解析 + ctx started

按以下优先级解析领域，**首个命中即停止**，输出 `[RITSU_CTX: domain={value}]`：

1. **P1**：读取项目根 `AGENTS.md` 的 `domain:` 字段。合法值：frontend / backend / fullstack / infra / data
2. **P2**：调用 `ritsu_get_changed_files`，使用返回的 `domain_hint` 字段
3. **P3**：P1/P2 均无法判断时，**强制询问用户**，不得自行猜测

解析完成后，调用 `ritsu_emit_event` 追加 started 事件：

```
ritsu_emit_event({
  event_type: "started",
  step: "1/{N}",
  correlation_id: "{cid}",
  skill: "{skill_name}",
  domain: "{value}"
})
```

**correlation_id 继承规则**：

- 若当前技能由 `/r-route` 路由触发 → 从 route 输出的 `[RITSU_CTX: ... cid={value}]` 中提取
- 若用户直接调用 `/r-{skill}`（跳过 route）→ 从 `ritsu_read_ctx` 返回的 `recovery_context.correlation_id` 或 `last_completed.correlation_id` 中继承
- 若为新链路（无历史且未经过 route）→ 自行生成 `cid-{YYYYMMDD}-1`

---

## Step 2: ctx 写入（仅 4 种核心事件）

### 技能完成时

```
ritsu_emit_event({
  event_type: "done",
  step: "{M}/{M}",
  correlation_id: "{cid}",
  skill: "{skill_name}",
  domain: "{value}",
  artifact: "{产物路径或null}"
})
```

### 产物写入时

调用 `ritsu_write_artifact` 写入产物文件后，追加：

```
ritsu_emit_event({
  event_type: "artifact_written",
  step: "{N}/{M}",
  correlation_id: "{cid}",
  skill: "{skill_name}",
  domain: "{value}",
  artifact: "{产物路径}",
  artifact_meta: { type: "{产物类型}", size_bytes: {大小}, summary: "{一句话摘要}" }
})
```

### 技能失败时

```
ritsu_emit_event({
  event_type: "failed",
  correlation_id: "{cid}",
  skill: "{skill_name}",
  domain: "{value}",
  error: "{一句话错误描述}"
})
```

> ⚠️ **精简原则**：不再写入 step*done / approval*\* / circuit_breaker / transition 事件。
> 审批、步骤进度、熔断告警等通过 AI 自然语言输出传达给用户，不写入 JSONL。
> 熔断状态由 `ritsu_read_ctx` 的 `circuit_breaker_status` 字段自动计算。

---

## Step 3: 关联流转 + 状态机引导

完成后按 `_shared/state-machine.yaml` 输出引导语。

关键流转路径：

```
route  → {matched_skill}
init   → think / route
think  → dev
dev    → review / optimize
optimize → review
review → dev(FAIL) / think(熔断) / optimize(PASS+优化空间) / triage(PASS+工单)
hunt   → dev(确诊后) / triage(工单来源)
triage → hunt / think / review / optimize
```

**熔断规则**（任一命中即引导至 `/r-think`）：

- review 连续两次 FAIL（`ritsu_read_ctx` 的 `circuit_breaker_status.consecutive_fails >= 2` 时自动检测）
- 同一 handoff 的 dev→review 循环 >3 次
- 同一模块的 optimize→review 循环 >2 次

熔断触发时，AI 直接输出告警并引导至 `/r-think`，不写入 circuit_breaker 事件。
