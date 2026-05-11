# Skill 公共步骤模板 v3.8.0

> 所有 SKILL.md 中重复出现的步骤，统一引用此模板，禁止各自重写。
> 引用方式：`> 引用 _shared/skill-common-steps.md Step N`
> ⚠️ 此文件已内联全部前置协议（含原 context-loader.md），LLM 读取此单文件即可执行，无需再跳转其他文件。

---

## Step 0: Pre-flight + 执行模式选择

每个技能在执行任何实质性动作前，**必须**先完成以下装载序列。

> **轻量技能豁免**：read / triage / document 技能可跳过 Step 0.1 和 0.3（无需读 AGENTS.md 和确认环境），仅执行 0.2（上下文恢复）和 0.4（模式选择）。

### 0.1 项目基线加载

- 读取项目根 `AGENTS.md`。
- 未找到 `AGENTS.md`：
  - 非 `/r-init` 技能 → 警告 "⚠️ 未发现 AGENTS.md，将自动触发 /r-init" 并执行 init 装载逻辑，完成后继续当前技能
  - `/r-init` 本身 → 正常继续
- 找到 `AGENTS.md`：校验 `last_updated` 时间戳，超过 7 天发出提示 "💡 AGENTS.md 已超过 7 天未更新，建议 /r-init:refresh"，但不阻塞

### 0.2 上下文恢复检查

调用 `ritsu_read_ctx`：

- `recovery_context` 非空 → 提示"检测到未完成任务"，展示 `resume_hint`，询问是否继续
- `circuit_breaker_status.should_redirect` 非空 → 提示"检测到熔断状态"，建议先执行 `/r-think`
- `reality_check.desync_detected` 为 true → 提示"检测到 Git 时空错位"，自动忽略失效记录

**Context Pruning（抗 Token 炸弹）**：

- 优先使用 `recent_entries_pruned` 作为“近期上下文”输入（done/artifact_written 权重更高）
- failed 事件优先读取 `failed_summary`（按 skill 聚合），避免逐条 failed 把 token 撑爆

### 0.3 环境确认

- 通过读取 `package.json`/`.env`/`pom.xml` 等真实配置文件，抓取项目的**真实框架版本和运行端口**，禁止背诵"常见配置"

### 0.4 执行模式选择

根据变更规模选择执行模式：

| 模式         | 条件                                                 | 行为                                         |
| ------------ | ---------------------------------------------------- | -------------------------------------------- |
| **hotfix**   | 用户指定 `--hotfix`，且变更 ≤1 文件/≤10 行           | 仅 dev 技能支持，跳过全部前置，直接修改+自测 |
| **fast**     | 用户指定 `--fast`，或变更 ≤3 文件/≤30 行，无架构影响 | 按 SKILL.md `fast_mode.skip_steps` 跳步执行  |
| **standard** | 默认，或变更 >3 文件/>30 行，涉及架构                | 完整流程（当前 SKILL.md 定义的完整步骤）     |

**fast 模式执行协议**：

- 读取当前 SKILL.md 的 `fast_mode` 声明：
  - `skip_steps`：跳过列出的步骤编号，其余步骤顺序执行
  - `skip_artifacts: true`：不调用 `ritsu_write_artifact` 写入产物文件，不触发 `artifact_written` 事件
  - `self_test`：若非 null，跳过 review 直接调用指定工具自测（通常为 `ritsu_run_quality_gates`）
- 只调用 `ritsu_emit_event(started)` + `ritsu_emit_event(done)` 两个事件
- 输出精简交付摘要（涉及文件 + Lint/Test 结果）
- 不支持 fast 模式的技能（无 `fast_mode` 声明）：忽略 `--fast`，按 standard 执行

---

## Step 1: 领域解析 + ctx started

按以下优先级解析领域，**首个命中即停止**，输出 `[RITSU_CTX: domain={value}]`：

1. **P1**：读取项目根 `AGENTS.md` 的 `domain:` 字段。合法值：frontend / backend / fullstack / infra / data
2. **P2**：调用 `ritsu_get_changed_files`，使用返回的 `domain_hint` 字段
3. **P3**：P1/P2 均无法判断时，**强制询问用户**，不得自行猜测

领域解析完成后，加载领域配置：

- 始终加载 `domains/_base.yaml` + `domains/[domain].yaml`
- fullstack 领域使用扁平化后的 `domains/fullstack.yaml`，无需额外加载 `domains/frontend.yaml` 和 `domains/backend.yaml`
- route / triage 无需加载领域配置

解析完成后，调用 `ritsu_emit_event` 追加 started 事件：

```
ritsu_emit_event({
  event_type: "started",
  step: "1/{N}",
  skill: "{skill_name}",
  domain: "{value}"
})
```

> correlation_id 由 `ritsu_emit_event` 自动生成（格式 `cid-{YYYYMMDD}-{seq}`），同链路技能自动继承上一事件的 correlation_id，无需手动指定。

---

## Step 2: ctx 写入 + 失败恢复

### 技能完成时

```
ritsu_emit_event({
  event_type: "done",
  step: "{M}/{M}",
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
  skill: "{skill_name}",
  domain: "{value}",
  error: "{一句话错误描述}"
})
```

> ⚠️ **精简原则**：只写入 4 种核心事件（started/done/failed/artifact_written），审批/步骤进度/熔断告警通过 AI 自然语言输出。熔断状态由 `ritsu_read_ctx` 的 `circuit_breaker_status` 字段自动计算。

### 失败恢复协议

技能执行中途失败时，必须执行以下恢复操作，防止磁盘/ctx 状态不一致：

**代码变更回滚**（dev/optimize 失败）：

- 调用 `ritsu_exec({command: "git stash"})` 暂存未提交变更
- 告知用户"代码已 stash，可通过 `git stash pop` 恢复"

**不完整产物清理**（artifact 写入失败）：

- 若 `ritsu_write_artifact` 写入了一半的文件，调用 `ritsu_exec({command: "rm {文件路径}}")` 删除
- 不写入 `artifact_written` 事件

**ctx 状态修正**：

- 写入 `failed` 事件，`error` 字段描述失败原因和已执行的恢复操作
- 下次恢复时 `ritsu_read_ctx` 的 `recovery_context` 会指引正确的断点

---

## Step 3: 关联流转 + 状态机引导

完成后按 `_shared/state-machine.yaml` 输出引导语。查询 `states.{current_skill}.next` 确认合法流转目标。

**熔断规则**：引用 `_shared/state-machine.yaml` 的 `circuit_breaker` section，AI 不内联重复定义。

---

## Step 4: 统一交付摘要模板

所有技能完成后，必须输出交付摘要。使用以下统一模板，禁止各技能自定义格式：

```
## 律 (Ritsu) {skill_name} 落盘清单
- 涉及文件: {路径 + 改动概述}
- 溯源: {Handoff/Diagnosis/Review-Stamp 路径 或 无（风险已知悉）}
- Lint: ✅/❌/跳过 | Test: ✅/❌/跳过
```

**hotfix 模式精简版**：

```
## 🔥 Hotfix 落盘
- 文件: {路径}
- 变更: {一行描述}
- Lint: ✅/❌ | Test: ✅/❌
```

**read 模式精简版**（无文件变更）：

```
## 📖 阅读摘要
- 目标: {文件/模块}
- 核心发现: {1-3 条关键结论}
```
