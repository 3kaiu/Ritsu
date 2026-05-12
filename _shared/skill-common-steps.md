# Skill 公共步骤模板 v3.8.0

> 所有 SKILL.md 中重复出现的步骤，统一引用此模板，禁止各自重写。
> 引用方式：`> 引用 _shared/skill-common-steps.md Step N`
> 目标不是堆更多治理动作，而是为 `intake → deliver → assure` 提供最小公共骨架。
> 主产物模板统一维护在 `_shared/artifact-templates.md`，`route / pipe / review` 不得各自复制维护。
> 产物层级统一维护在 `_shared/artifact-layers.md`；写 ctx 的 `artifact_meta` 时应尽量同时写入 `type` 与 `layer`。
> 当前主链路主产物为：`intake-ticket / delivery-plan / delivery-report / assurance-report / release-advice`。

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

调用 `ritsu_read_ctx`：

- 若存在未完成任务，提示是否继续
- 若存在熔断状态，提示当前风险
- 若存在产物失配，提示状态已失真

**精简原则**：

- 优先使用 `recent_entries_pruned`
- failed 事件优先看 `failed_summary`

若需要额外检索 `.ritsu/` 历史产物，默认先查主链路产物（`layers=["primary"]`）；仅当主链路信息不足时，再扩展到过程证据（`layers=["evidence"]`）或兼容镜像。

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

---

## Step 1: 领域解析 + ctx started

按以下优先级解析领域，首个命中即停止，输出 `[RITSU_CTX: domain={value}]`：

1. 读取 `AGENTS.md` 的 `domain`
2. 调用 `ritsu_get_changed_files`，使用返回的 `domain_hint`
3. 均无法判断时再询问用户

领域解析完成后：

- 加载 `domains/_base.yaml` + `domains/[domain].yaml`
- `fullstack` 直接使用扁平化配置
- `route / triage` 可不加载详细领域增量

随后调用 `ritsu_emit_event` 追加 started 事件：

```text
ritsu_emit_event({
  event_type: "started",
  step: "1/{N}",
  skill: "{skill_name}",
  domain: "{value}"
})
```

> correlation_id 由 `ritsu_emit_event` 自动生成并沿链路继承。

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

状态机现在优先表达产品阶段流转，而不是暴露过多内部 skill 跳转：

- `intake`
- `deliver.quick`
- `deliver.standard`
- `deliver.critical`
- `assure`
- `extensions.*`

若某个内部 skill 仍需细粒度跳转，应服从所属阶段的边界。

---

## Step 4: 统一交付摘要模板

所有技能完成后，必须输出精简摘要。

### 通用模板

```markdown
## 律 (Ritsu) {skill_name} 落盘清单
- 涉及文件: {路径 + 改动概述}
- 溯源: {intake-ticket/delivery-plan/handoff/diagnosis/delivery-report/assurance-report/release-advice 路径 或 无}
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
