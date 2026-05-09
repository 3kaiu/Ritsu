# Skill 公共步骤模板 v3.3.1

> 所有 SKILL.md 中重复出现的三个步骤，统一引用此模板，禁止各自重写。
> 引用方式：`> 引用 _shared/skill-common-steps.md Step N`
> ⚠️ 此文件已内联关键协议，LLM 读取此单文件即可执行，无需再跳转其他文件。

---

## Step 1: 领域解析 + ctx started

按以下优先级解析领域，**首个命中即停止**，输出 `[RITSU_CTX: domain={value}]`：

1. **P1**：读取项目根 `AGENTS.md` 的 `domain:` 字段。合法值：frontend / backend / fullstack / infra / data
2. **P2**：分析变更文件后缀推断（.tsx/.vue→frontend, .go/.java→backend, 混合→fullstack, .tf/.yml→infra, .py/.ipynb→data）
3. **P3**：P1/P2 均无法判断时，**强制询问用户**，不得自行猜测

解析完成后，调用 `ritsu_write_artifact`（type=ctx, filename=ctx-{YYYY-MM}.jsonl）追加：

```json
{
  "ts": "{YYYYMMDD-HHMMSS}",
  "skill": "{skill_name}",
  "domain": "{value}",
  "status": "started",
  "artifact": null,
  "progress": "{skill_name}:chunk{N}/{M}"
}
```

`progress` 仅分块执行时填写（如 dev:chunk2/5、optimize:item3/8），否则为 `null`。

---

## Step 2: ctx 写入（完成/失败时）

调用 `ritsu_write_artifact`（type=ctx, filename=ctx-{YYYY-MM}.jsonl）追加：

**完成时**：

```json
{
  "ts": "{YYYYMMDD-HHMMSS}",
  "skill": "{skill_name}",
  "domain": "{value}",
  "status": "done",
  "artifact": "{产物路径或null}",
  "progress": null
}
```

**失败时**：

```json
{
  "ts": "{YYYYMMDD-HHMMSS}",
  "skill": "{skill_name}",
  "domain": "{value}",
  "status": "failed",
  "artifact": null,
  "progress": null
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
