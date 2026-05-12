# Skill 公共步骤模板 v3.8.0

> 所有 `SKILL.md` 中重复出现的步骤，统一引用此模板，禁止各自重写。
> 引用方式：`> 引用 _shared/skill-common-steps.md Step N`
> 目标不是再加一层编排，而是为 `think -> dev/test/hunt -> review` 提供最小公共骨架。
> 自 v3.8 起，若 runtime 已提供对应 flow，应优先使用 `ritsu_run_flow / ritsu_resume_flow / ritsu_get_flow_state / ritsu_apply_flow_decision` 作为执行骨架，再由 AI 补齐判断位。
> 主产物模板统一维护在 `_shared/artifact-templates.md`。
> 产物层级统一维护在 `_shared/artifact-layers.md`；写 ctx 的 `artifact_meta` 时应尽量同时写入 `type` 与 `layer`。

---

## Step 0: Pre-flight + 执行模式选择

每个技能在执行任何实质性动作前，先完成最小装载序列。

> **轻量技能豁免**：`read / triage / document` 可跳过 0.1 和 0.3，仅执行 0.2 和 0.4。

### 0.1 项目基线加载

- 读取项目根 `AGENTS.md`
- 若不存在：
  - `/r-init` 正常继续
  - 其他技能提示“未发现 AGENTS.md，建议先初始化项目基线”
- 若存在但明显过旧，可提示刷新，但不默认阻塞

### 0.2 上下文恢复检查

调用 `ritsu_read_ctx`；若项目中已有 flow run，再补 `ritsu_get_flow_state`：

- 若存在未完成任务，提示是否继续
- 若存在熔断状态，提示当前风险
- 若存在产物失配，提示状态已失真
- 若存在 flow recovery point，优先按 `current_step / recovery_point / verification_status` 恢复

**精简原则**：

- 优先使用 `recent_entries_pruned`
- failed 事件优先看 `failed_summary`

若需要额外检索 `.ritsu/` 历史产物，默认先查主产物（`layers=["primary"]`）；仅当主产物信息不足时，再扩展到过程证据（`layers=["evidence"]`）或兼容镜像。

### 0.3 环境确认

- 通过读取 `package.json` / `.env` / `pom.xml` 等真实文件确认环境
- 禁止背诵“常见配置”

### 0.4 执行模式选择

根据任务风险和变更规模选择模式：

| 模式 | 适用情况 | 行为 |
| --- | --- | --- |
| `quick` | 小改动、低风险、信息充分 | 降低交互成本，保留基本验证 |
| `standard` | 默认模式 | 走正常闭环 |
| `critical` | 架构、迁移、发布风险高 | 强制增加边界、验证、回滚要求 |

兼容历史模式：

- `--hotfix` 视为 `quick` 的极小改动子集
- `--fast` 视为降低输出和交互密度，而不是跳过关键验证

### 0.5 Flow 骨架选择

若当前技能有对应内建 flow，优先执行：

- `think` -> `think-clarify`
- `dev` -> `dev-delivery`
- `test` -> `test-verify`
- `hunt` -> `hunt-recovery`
- `review` -> `review-acceptance`

执行规则：

- 先用 `ritsu_list_flows` / `ritsu_validate_flow` 对账可用模板
- 若已有未完成 run，优先 `ritsu_get_flow_state` + `ritsu_resume_flow`
- 否则用 `ritsu_run_flow` 建立 flow state
- 若 runtime 停在 `awaiting_ai`，AI 只负责当前判断位，不重复手搓整条流程
- 当前判断位完成后，必须优先 `ritsu_apply_flow_decision` 回写 decision 和关联 artifacts，而不是重新开新 flow
- 若会话中断，恢复时优先 `ritsu_resume_flow`

---

## Step 1: 领域解析 + ctx started

按以下优先级解析领域，首个命中即停止，输出 `[RITSU_CTX: domain={value}]`：

1. 读取 `AGENTS.md` 的 `domain`
2. 调用 `ritsu_get_changed_files`，使用返回的 `domain_hint`
3. 均无法判断时再询问用户

领域解析完成后：

- 加载 `domains/_base.yaml` + `domains/[domain].yaml`
- `fullstack` 直接使用扁平化配置
- `read / triage / document` 可不加载详细领域增量

随后调用 `ritsu_emit_event` 追加 started 事件：

```text
ritsu_emit_event({
  event_type: "started",
  step: "1/{N}",
  skill: "{skill_name}",
  domain: "{value}"
})
```

> correlation_id 由 flow runtime 首次 `started` 事件生成，并沿 `artifact_written / done / failed` 继承；若未走 flow runtime，则由 `ritsu_emit_event` 自动生成。

---

## Step 2: ctx 写入 + 失败恢复

### 技能完成时

```text
ritsu_emit_event({
  event_type: "done",
  step: "{M}/{M}",
  skill: "{skill_name}",
  domain: "{value}",
  artifact: "{产物路径或null}"
})
```

### 产物写入时

调用 `ritsu_write_artifact` 后，追加：

```text
ritsu_emit_event({
  event_type: "artifact_written",
  step: "{N}/{M}",
  skill: "{skill_name}",
  domain: "{value}",
  artifact: "{产物路径}",
  artifact_meta: { type: "{产物类型}", size_bytes: {大小}, summary: "{一句话摘要}" }
})
```

### 技能失败时

```text
ritsu_emit_event({
  event_type: "failed",
  skill: "{skill_name}",
  domain: "{value}",
  error: "{一句话错误描述}"
})
```

### 失败恢复协议

失败时优先保证状态真实，而不是掩盖失败：

- 若有代码变更，明确告知当前工作区状态
- 若有半写入产物，清理不完整文件
- 必须写入 `failed` 事件，保留恢复线索

不要求所有技能都自动执行激进回滚；只有在该技能文档明确要求时才做自动恢复动作。

---

## Step 3: 关联流转 + 状态机引导

完成后按 `_shared/state-machine.yaml` 输出下一步建议。

状态机现在优先表达显式 skill 流转，而不是抽象阶段：

- `think`
- `dev`
- `test`
- `hunt`
- `review`
- `extensions.*`

若某个专项 skill 仍需细粒度跳转，应服从主工作流边界。

若当前任务已绑定 flow run，下一步建议还应和 flow state 的 `next_phase_recommendations` 对账。

---

## Step 4: 统一交付摘要模板

所有技能完成后，必须输出精简摘要。

### 通用模板

```markdown
## 律 (Ritsu) {skill_name} 落盘清单
- 涉及文件: {路径 + 改动概述}
- 溯源: {think-ticket/think-plan/handoff/diagnosis/dev-report/review-report/review-advice 路径，或对应兼容旧名路径，或 无}
- Lint: ✅/❌/跳过 | Test: ✅/❌/跳过
```

### Quick / Hotfix 精简版

```markdown
## 🔥 Quick 交付摘要
- 文件: {路径}
- 变更: {一行描述}
- 验证: {已做的最小验证}
```

### Read 精简版

```markdown
## 📖 阅读摘要
- 目标: {文件/模块}
- 核心发现: {1-3 条关键结论}
```
