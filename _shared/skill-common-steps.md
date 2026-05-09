# Skill 公共步骤模板 v3.3.0

> 所有 SKILL.md 中重复出现的三个步骤，统一引用此模板，禁止各自重写。
> 引用方式：`> 引用 _shared/skill-common-steps.md Step N`

---

## Step 1: 领域解析

> 引用 `_shared/domain-resolver.md`，输出 `[RITSU_CTX: domain={value}]`

写入 ctx-{YYYY-MM}.jsonl（调用 **`ritsu_write_artifact`** type=ctx）：

```
{"ts":"{timestamp}","skill":"{skill_name}","domain":"{value}","status":"started","artifact":null,"progress":"{skill_name}:chunk{N}/{M}"}
```

`progress` 仅分块执行时填写（如 dev:chunk2/5、optimize:item3/8），否则为 `null`。

---

## Step 2: ctx 写入（完成时）

写入 ctx-{YYYY-MM}.jsonl（调用 **`ritsu_write_artifact`** type=ctx）：

```
{"ts":"{timestamp}","skill":"{skill_name}","domain":"{value}","status":"done","artifact":"{产物路径或null}","progress":null}
```

失败时 `status` 改为 `failed`，`artifact` 为 `null`，`progress` 为 `null`。

---

## Step 3: 关联流转

> 引用 `_shared/state-machine.yaml` — {skill_name} 完成引导语。
