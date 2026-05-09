# Skill 公共步骤模板 v3.4.0

> 所有 SKILL.md 中重复出现的三个步骤，统一引用此模板，禁止各自重写。
> 引用方式：`> 引用 _shared/skill-common-steps.md Step N`
> ⚠️ 此文件已内联关键协议，LLM 读取此单文件即可执行，无需再跳转其他文件。

---

## Step 0: 结构化输出协议 (Structured Output Protocol)

每个技能的输出必须遵循以下格式约束，禁止自由格式输出：

1. **步骤输出**：每个 `[Step N Complete]` 后必须输出该步骤的结论摘要（≤3 行），禁止输出中间推理过程
2. **步骤事件**：每个 `[Step N Complete]` 标记同时，必须追加 `step_done` 事件到 ctx（见 Step 2）。`[Step N Complete]` 是人读锚点，`step_done` 是机读事件，两者必须成对出现
3. **交付输出**：技能结束时必须输出标准交付块（见各 SKILL.md 末尾的交付摘要模板）
4. **错误输出**：遇到失败时必须输出结构化错误块：
   ```
   ❌ [{skill}] Step {N} 失败
   - 原因: {一句话描述}
   - 已执行: {已完成的步骤列表}
   - 建议恢复: {下一步动作}
   ```
5. **禁止冗余**：不重复 frontmatter 中已声明的 HC，不重复引用已完成的步骤内容

### 审批协议 (Approval Protocol)

当技能执行中需要人类确认时，必须通过结构化审批事件而非纯文本询问：

1. 追加 `approval_required` 事件到 ctx（含 `approval.type`/`title`/`options`/`context`）
2. 向用户展示审批选项（UI 可渲染为 ApprovalDialog 组件）
3. 收到用户选择后追加 `approval_granted` 或 `approval_denied` 事件
4. 被拒绝时按用户指示回退或终止

**审批类型**：

| type               | 场景          | options 示例                   |
| ------------------ | ------------- | ------------------------------ |
| `confirm`          | 简单是/否确认 | ["确认", "取消"]               |
| `choose`           | 多选一决策    | ["方案A", "方案B", "跳过"]     |
| `review_dangerous` | 危险操作审查  | ["执行", "修改后执行", "取消"] |

---

## Step 1: 领域解析 + ctx started

按以下优先级解析领域，**首个命中即停止**，输出 `[RITSU_CTX: domain={value}]`：

1. **P1**：读取项目根 `AGENTS.md` 的 `domain:` 字段。合法值：frontend / backend / fullstack / infra / data
2. **P2**：分析变更文件后缀推断（.tsx/.vue→frontend, .go/.java→backend, 混合→fullstack, .tf/.yml→infra, .py/.ipynb→data）
3. **P3**：P1/P2 均无法判断时，**强制询问用户**，不得自行猜测

解析完成后，调用 `ritsu_write_artifact`（type=ctx, filename=ctx-{YYYY-MM}.jsonl）追加：

```jsonl
{
  "ts": "{YYYYMMDD-HHMMSS}",
  "correlation_id": "{cid}",
  "skill": "{skill_name}",
  "domain": "{value}",
  "status": "started",
  "step": "1/{N}",
  "artifact": null,
  "progress": "{skill_name}:chunk{N}/{M}"
}
```

`step` 格式为 `{current}/{total}`（如 `1/5`），`progress` 仅分块执行时填写（如 dev:chunk2/5、optimize:item3/8），否则为 `null`。
`correlation_id` 由 route 技能生成（格式 `cid-{YYYYMMDD}-{seq}`），同链路技能继承此 ID，用于 UI 关联同一任务链路的所有事件。

**correlation_id 继承规则**：

- 若当前技能由 `/r-route` 路由触发 → 从 route 输出的 `[RITSU_CTX: ... cid={value}]` 中提取
- 若用户直接调用 `/r-{skill}`（跳过 route）→ 从 `ritsu_read_ctx` 返回的 `last_completed.correlation_id` 或 `last_incomplete.correlation_id` 中继承
- 若为新链路（无历史且未经过 route）→ 自行生成 `cid-{YYYYMMDD}-1`

---

## Step 2: ctx 写入（步骤/完成/失败时）

### 步骤完成时

每个步骤完成后，调用 `ritsu_write_artifact`（type=ctx）追加：

```jsonl
{"ts":"{YYYYMMDD-HHMMSS}","correlation_id":"{cid}","skill":"{skill_name}","domain":"{value}","status":"step_done","step":"{N}/{M}","artifact":null,"progress":null,"duration_ms":{耗时毫秒}}
```

### 产物写入时

调用 `ritsu_write_artifact` 写入产物文件后，追加：

```jsonl
{"ts":"{YYYYMMDD-HHMMSS}","correlation_id":"{cid}","skill":"{skill_name}","domain":"{value}","status":"artifact_written","step":"{N}/{M}","artifact":"{产物路径}","progress":null,"artifact_meta":{"type":"{产物类型}","size_bytes":{大小},"summary":"{一句话摘要}"}}
```

### 步骤失败时

```jsonl
{
  "ts": "{YYYYMMDD-HHMMSS}",
  "correlation_id": "{cid}",
  "skill": "{skill_name}",
  "domain": "{value}",
  "status": "step_failed",
  "step": "{N}/{M}",
  "artifact": null,
  "progress": null,
  "error": "{一句话错误描述}"
}
```

若由 anti-pattern 触发，增加 `violation` 字段：

```jsonl
{
  "ts": "...",
  "skill": "...",
  "domain": "...",
  "status": "step_failed",
  "step": "2/5",
  "artifact": null,
  "progress": null,
  "error": "AP-2: 引用未验证标识符",
  "violation": {
    "id": "AP-2",
    "severity": "FATAL",
    "pattern": "Hallucinate paths",
    "evidence": "grep 返回 0 matches"
  }
}
```

### 技能完成时

```jsonl
{"ts":"{YYYYMMDD-HHMMSS}","correlation_id":"{cid}","skill":"{skill_name}","domain":"{value}","status":"done","step":"{M}/{M}","artifact":"{产物路径或null}","progress":null,"duration_ms":{总耗时毫秒}}
```

### 技能失败时

```jsonl
{
  "ts": "{YYYYMMDD-HHMMSS}",
  "correlation_id": "{cid}",
  "skill": "{skill_name}",
  "domain": "{value}",
  "status": "failed",
  "step": "{N}/{M}",
  "artifact": null,
  "progress": null,
  "error": "{一句话错误描述}"
}
```

---

## Step 3: 关联流转 + 状态机引导

完成后按 `_shared/state-machine.yaml` 输出引导语。关键流转路径：

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

- review 连续两次 FAIL
- 同一 handoff 的 dev→review 循环 >3 次
- 同一模块的 optimize→review 循环 >2 次

熔断触发时追加 `circuit_breaker` 事件：

```jsonl
{
  "ts": "{YYYYMMDD-HHMMSS}",
  "correlation_id": "{cid}",
  "skill": "{skill_name}",
  "domain": "{value}",
  "status": "circuit_breaker",
  "step": "{N}/{M}",
  "artifact": null,
  "progress": null,
  "error": "{熔断原因}",
  "redirect": "think"
}
```
