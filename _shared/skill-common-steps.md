# Skill 公共步骤模板 v3.8.0

> 所有 SKILL.md 中重复出现的步骤，统一引用此模板，禁止各自重写。
> 引用方式：`> 引用 _shared/skill-common-steps.md Step N`
> ⚠️ 此文件已内联全部前置协议（含原 context-loader.md），LLM 读取此单文件即可执行，无需再跳转其他文件。

---

## Step 0: Pre-flight + 执行模式选择

每个技能在执行任何实质性动作前，**必须**先完成以下装载序列。

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

### 0.3 环境与依赖确认

并发执行：

- **环境配置**：通过读取 `package.json`/`.env`/`pom.xml` 等真实配置文件，抓取项目的**真实框架版本和运行端口**，禁止背诵"常见配置"
- **依赖收束**：确认技能执行时只使用 `AGENTS.md` 规定的技术栈；新增依赖须检查版本兼容性、安全漏洞、License 合规性

### 0.4 执行模式选择

根据变更规模选择执行模式：

| 模式         | 条件                                                 | 行为                                                             |
| ------------ | ---------------------------------------------------- | ---------------------------------------------------------------- |
| **fast**     | 用户指定 `--fast`，或变更 ≤3 文件/≤30 行，无架构影响 | 跳过 think/review，dev 直接执行 + `ritsu_run_quality_gates` 自测 |
| **standard** | 默认，或变更 >3 文件/>30 行，涉及架构                | 完整流程（当前 SKILL.md 定义的完整步骤）                         |

**fast 模式规范**：

- 只调用 `ritsu_emit_event(started)` + `ritsu_emit_event(done)` 两个事件
- 直接调用 `ritsu_run_quality_gates` 验证
- 输出精简交付摘要（涉及文件 + Lint/Test 结果）
- 不写 handoff/diagnosis/review-stamp 产物

---

## Step 1: 领域解析 + ctx started

按以下优先级解析领域，**首个命中即停止**，输出 `[RITSU_CTX: domain={value}]`：

1. **P1**：读取项目根 `AGENTS.md` 的 `domain:` 字段。合法值：frontend / backend / fullstack / infra / data
2. **P2**：调用 `ritsu_get_changed_files`，使用返回的 `domain_hint` 字段
3. **P3**：P1/P2 均无法判断时，**强制询问用户**，不得自行猜测

领域解析完成后，**按需加载领域配置**（仅加载当前 skill 声明的 `required_sections`）：

| Skill             | 加载 sections                                                                 | 跳过 sections                                                   |
| ----------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| route / triage    | 无需加载 domain                                                               | 全部                                                            |
| init              | `hypothesis_directions`                                                       | `coding_disciplines`, `attack_vectors`, `optimize_*`            |
| think             | `hypothesis_directions`, `coding_disciplines`                                 | `attack_vectors`, `optimize_*`                                  |
| dev / test        | `coding_disciplines`, `attack_vectors`                                        | `hypothesis_directions`, `optimize_*`                           |
| optimize          | `optimize_disciplines`, `optimize_tool_preferences`, `platform_optimizations` | `hypothesis_directions`, `coding_disciplines`, `attack_vectors` |
| review            | `attack_vectors`, `coding_disciplines`                                        | `hypothesis_directions`, `optimize_*`                           |
| hunt              | `hypothesis_directions`                                                       | `coding_disciplines`, `attack_vectors`, `optimize_*`            |
| deploy / document | `coding_disciplines`                                                          | `hypothesis_directions`, `attack_vectors`, `optimize_*`         |

加载规则：

- 始终加载 `domains/_base.yaml`
- 加载 `domains/[domain].yaml`
- fullstack 领域同时加载 `domains/frontend.yaml` 和 `domains/backend.yaml`

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

完成后按 `_shared/state-machine.yaml` 输出引导语。

关键流转路径：

```
route  → {matched_skill} / pipe
pipe   → think / dev / review / hunt / optimize / test
init   → think / route
think  → dev
dev    → review / optimize / test
test   → review(通过) / dev(失败)
optimize → review
review → dev(FAIL) / think(熔断) / optimize(PASS+优化空间) / triage(PASS+工单) / deploy(PASS+部署)
hunt   → dev(确诊后) / triage(工单来源)
triage → hunt / think / review / optimize
deploy → review / hunt
document → review / dev
```

**熔断规则**：引用 `_shared/state-machine.yaml` 的 `circuit_breaker` section，AI 不内联重复定义。

---

## Step 4: 上下文窗口管理 (Context Window Management)

每个 SKILL.md 声明了 `context_window_guidance`（建议值，非硬性约束）。当对话上下文接近或超出建议值时，执行以下策略：

### 预算阈值

| 阶段     | 占 context_window_guidance 比例 | 动作                                                                 |
| -------- | ------------------------------- | -------------------------------------------------------------------- |
| **绿色** | < 60%                           | 正常执行，无需压缩                                                   |
| **黄色** | 60%-85%                         | 启用精简输出：省略重复上下文、压缩步骤描述为关键结论、跳过非必要解释 |
| **红色** | > 85%                           | 强制压缩：只输出必需的决策和操作结果，省略所有中间推理过程           |

### 压缩策略（按优先级执行）

1. **省略已完成的步骤描述**：已完成步骤的详细过程不再复述，只保留结论（如"Step 2 ✅: 领域=frontend"）
2. **压缩领域配置引用**：不内联 `domains/*.yaml` 的完整内容，改为引用 ID（如"按 FE-D1/FE-D2 执行"）
3. **省略重复的上下文**：同一文件内容不二次输出，改为"同上文 {文件路径}"
4. **分段执行**：当实施清单超过 5 项时，主动提议分段执行（每段 2-3 项），段间确认后继续
5. **产物摘要替代全文**：写入产物后，输出一句话摘要而非产物全文

### 超长对话恢复

当用户在新会话中恢复任务时：

- `ritsu_read_ctx` 只返回 `recovery_context`（最近未完成事件）+ 最近一条 `artifact_written`
- 不加载历史对话全文，通过 `ritsu_list_artifacts` 按需读取特定产物
