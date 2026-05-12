---
name: route
version: "3.8.0"
description: "Ritsu 需求受理入口。识别任务类型、风险等级和执行路径，输出统一执行单。"
when_to_use: "/r-route, 我不知道该用哪个命令, 帮我决定, 从哪开始"
total_steps: 5
hard_constraints:
  - id: HC-1
    rule: "只做需求受理与执行路径判定，不执行实质性的开发/设计/诊断工作"
    severity: FATAL
  - id: HC-2
    rule: "识别到多个意图或隐含风险时，必须显式写入执行单，不得静默丢弃"
    severity: FATAL
---

# Route: Intake 需求受理入口 (Intake Gateway)

**触发条件**：用户输入 `/r-route`，或表达了意图但尚未形成清晰执行路径。

> 当前文件名仍为 `route`，但产品语义上承担 `intake`。

## 执行流水线

### 1. 上下文恢复与现实对账 (Context Recovery & Reality Check)

调用 **`ritsu_read_ctx`** 工具解析历史任务状态：

- 若存在未完成任务，提示是否继续
- 若存在熔断状态，提示当前风险
- 若发现产物丢失，提示状态已失配

**Context Pruning**：

- 优先读取 `recent_entries_pruned`
- failed 事件优先读取 `failed_summary`

若为澄清当前任务而需要额外查看历史产物，默认先查主链路产物（`intake-ticket / delivery-plan / delivery-report / assurance-report / release-advice`）；只有主链路不足以解释上下文时，才补充 `handoff / diagnosis` 等过程证据。

### 2. 领域解析

> 引用 `_shared/skill-common-steps.md` Step 1

> 优先调用 `ritsu_get_changed_files` 获取 `domain_hint`，作为领域解析的 P2 依据。

### 3. 任务识别与执行路径判定

`[Step 2 Complete]` 后，不再把结果主要表达为“你该调用哪个 skill”，而是收敛为统一受理判断。

**任务类型**（至少识别其一）：

- 新功能
- Bug 修复
- 补测试
- 重构
- 优化
- 纯阅读 / 纯咨询
- 扩展任务（文档 / 部署 / triage）

**风险等级**：

- `quick`：小改动、低风险、信息充分
- `standard`：常规任务，需正常验证
- `critical`：涉及架构、迁移或高发布风险

**信息完备度**：

- 是否缺少复现步骤
- 是否缺少验收标准
- 是否缺少上下文文件/模块
- 是否缺少风险边界

**推荐路径**：

- 新功能 / 常规开发 → `deliver.standard`
- 小改动 / 明确修复 → `deliver.quick`
- 高风险变更 → `deliver.critical`
- 仅需结论审查 → `assure`
- 非主链路任务 → 扩展模块

### 4. 输出执行单

```markdown
[RITSU_CTX: domain={value}]

## Intake 执行单
- 任务类型: {新功能/Bug/补测试/重构/优化/纯阅读/扩展任务}
- 风险等级: {quick/standard/critical}
- 当前目标: {一句话描述}
- 信息完备度: {充分/部分缺失/严重缺失}
- 缺失信息: {若无则写“无”}
- 推荐路径: {deliver.quick / deliver.standard / deliver.critical / assure / extension}
- 次要意图: {若无则写“无”}
- 备注风险: {若无则写“无”}
```

**输出要求**：

- 优先给执行路径，不优先给命令说明
- 需要补信息时，一次性列全
- 只有在确实需要用户显式选择时才中断

执行单形成后，调用 **`ritsu_write_artifact`**（type=`intake-ticket`）写入主受理产物，内容至少包含：

- `## 任务识别`
  - `任务类型`
  - `当前目标`
- `## 风险与信息`
  - `风险等级`
  - `信息完备度`
  - `缺失信息`
- `## 执行路径`
  - `推荐路径`
  - `次要意图`

推荐骨架：

> 引用 `_shared/artifact-templates.md` Intake Ticket

`intake-ticket` 的职责是沉淀“需求已被如何理解、下一步应如何推进”，不是替代后续 `delivery-plan` 或 `handoff` 的实施清单。

**与后续主产物的边界**：

- `intake-ticket`：定义需求理解、风险、执行路径
- `delivery-plan`：定义实施目标范围、步骤、验证计划、回滚说明
- `delivery-report`：定义实际交付结果与风险
- `assurance-report / release-advice`：定义验收与发布建议

### 5. 写入 ctx

执行单确认后，写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=route, artifact=.ritsu/intake-ticket-{ts}.md）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=route）
