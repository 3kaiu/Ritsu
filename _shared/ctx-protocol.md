# 情景记忆持久化协议 (Context Protocol)

> Ritsu Bundle 共享协议 v3.4.0
> 解决问题：会话重置后 AI 丢失当前任务上下文（任务在哪一步、领域是什么、产物在哪里）
> v3.4.0 扩展：从 3 态记录（started/done/failed）演进为全生命周期事件流，支持 UI 渲染

---

## 协议规则

### 写入时机

每个技能的执行过程中，**按事件类型追加记录**到当月的任务状态文件 `{项目根}/.ritsu/ctx-{YYYY-MM}.jsonl` 中。

### 事件类型 (status 枚举)

| status              | 触发时机                   | 必填附加字段                        | UI 渲染建议                |
| ------------------- | -------------------------- | ----------------------------------- | -------------------------- |
| `started`           | 技能启动（领域解析完成后） | `step`                              | SkillTimeline 起始节点     |
| `step_done`         | 单个步骤完成               | `step`, `duration_ms`               | 进度条推进 + 耗时标注      |
| `step_failed`       | 单个步骤失败               | `step`, `error`                     | 红色错误节点 + 错误描述    |
| `approval_required` | 需要人类审批               | `step`, `approval`                  | ApprovalDialog 弹出        |
| `approval_granted`  | 人类批准                   | `step`, `approval`                  | ApprovalDialog 关闭        |
| `approval_denied`   | 人类拒绝                   | `step`, `approval`                  | ApprovalDialog 关闭 + 回退 |
| `artifact_written`  | 产物文件写入完成           | `step`, `artifact`, `artifact_meta` | 产物预览卡片               |
| `circuit_breaker`   | 熔断触发                   | `step`, `error`                     | 红色告警 + 重定向提示      |
| `done`              | 技能完成                   | `artifact`, `duration_ms`           | SkillTimeline 终止节点     |
| `failed`            | 技能失败                   | `error`                             | 红色终止节点               |

> ⚠️ **向后兼容**：旧 LLM 忽略新增 status 值和附加字段，只读 `started/done/failed` 仍可正常工作。

### 记录格式（JSONL，每行一个 JSON 对象，追加不覆盖）

**基础示例（3 态，向后兼容）**：

```jsonl
{"ts":"20260509-145000","correlation_id":"cid-20260509-001","skill":"think","domain":"backend","status":"started","step":"1/4","artifact":null,"progress":null}
{"ts":"20260509-145010","correlation_id":"cid-20260509-001","skill":"think","domain":"backend","status":"step_done","step":"1/4","artifact":null,"progress":null,"duration_ms":500}
{"ts":"20260509-145020","correlation_id":"cid-20260509-001","skill":"think","domain":"backend","status":"step_done","step":"2/4","artifact":null,"progress":null,"duration_ms":1200}
{"ts":"20260509-145030","correlation_id":"cid-20260509-001","skill":"think","domain":"backend","status":"artifact_written","step":"3/4","artifact":".ritsu/handoff-user-login-flow.md","progress":null,"artifact_meta":{"type":"handoff","size_bytes":2340,"summary":"用户登录流程设计，含 5 个实施项"}}
{"ts":"20260509-145040","correlation_id":"cid-20260509-001","skill":"think","domain":"backend","status":"done","step":"4/4","artifact":".ritsu/handoff-user-login-flow.md","progress":null,"duration_ms":3200}
```

**审批事件示例**：

```jsonl
{"ts":"20260509-145030","correlation_id":"cid-20260509-001","skill":"dev","domain":"backend","status":"approval_required","step":"3/5","artifact":null,"progress":null,"approval":{"type":"confirm","title":"确认删除以下未引用文件","options":["全部确认","仅删除安全项","取消"],"context":{"files":["utils/old-helper.ts","types/deprecated.d.ts"]}}}
{"ts":"20260509-145040","correlation_id":"cid-20260509-001","skill":"dev","domain":"backend","status":"approval_granted","step":"3/5","artifact":null,"progress":null,"approval":{"choice":"全部确认"}}
```

**熔断事件示例**：

```jsonl
{
  "ts": "20260509-152000",
  "correlation_id": "cid-20260509-001",
  "skill": "review",
  "domain": "backend",
  "status": "circuit_breaker",
  "step": "2/3",
  "artifact": null,
  "progress": null,
  "error": "连续两次 FAIL，熔断触发",
  "redirect": "think"
}
```

**violation 事件示例**：

```jsonl
{
  "ts": "20260509-145030",
  "correlation_id": "cid-20260509-001",
  "skill": "dev",
  "domain": "backend",
  "status": "step_failed",
  "step": "2/5",
  "artifact": null,
  "progress": null,
  "error": "AP-2: 引用未验证标识符 'useAuth'",
  "violation": {
    "id": "AP-2",
    "severity": "FATAL",
    "pattern": "Hallucinate paths",
    "evidence": "grep 返回 0 matches for useAuth"
  }
}
```

**字段说明**：

| 字段             | 类型         | 必填 | 说明                                                                                            |
| ---------------- | ------------ | ---- | ----------------------------------------------------------------------------------------------- |
| `ts`             | string       | ✅   | `YYYYMMDD-HHMMSS` 格式时间戳                                                                    |
| `correlation_id` | string       | ✅   | 任务链路关联 ID（格式 `cid-{YYYYMMDD}-{seq}`），由 route 生成，同链路技能继承                   |
| `skill`          | string       | ✅   | 技能名：route/init/think/dev/optimize/review/hunt/triage                                        |
| `domain`         | string       | ✅   | 领域值：frontend/backend/fullstack/infra/data                                                   |
| `status`         | enum         | ✅   | 见上方事件类型表                                                                                |
| `step`           | string       | ⚠️   | 格式 `{current}/{total}`（如 `2/5`），step*done/step_failed/approval*\*/artifact_written 时必填 |
| `artifact`       | string\|null | ✅   | 产物文件路径，无则为 `null`                                                                     |
| `progress`       | string\|null |      | 执行进度标记（如 `dev:chunk2/5`），仅 `started` 状态需要，`done`/`failed` 时为 `null`           |
| `duration_ms`    | number       |      | 步骤/技能耗时毫秒，step_done/done 时可选                                                        |
| `error`          | string       |      | step_failed/failed/circuit_breaker 时必填，一句话错误描述                                       |
| `approval`       | object       |      | approval_required/granted/denied 时必填，见审批协议                                             |
| `artifact_meta`  | object       |      | artifact_written 时必填，见产物元数据                                                           |
| `violation`      | object       |      | step_failed 且由 anti-pattern 触发时可选，见 violation 协议                                     |
| `redirect`       | string       |      | circuit_breaker 时必填，重定向目标技能名                                                        |

**审批协议字段 (approval)**：

| 子字段    | 类型     | 必填           | 说明                                                                       |
| --------- | -------- | -------------- | -------------------------------------------------------------------------- |
| `type`    | enum     | ✅             | `confirm`（是/否）/ `choose`（多选一）/ `review_dangerous`（危险操作审查） |
| `title`   | string   | ✅             | 审批标题（UI 渲染为对话框标题）                                            |
| `options` | string[] | ✅             | 可选项列表                                                                 |
| `context` | object   |                | 审批上下文数据（如文件列表、diff 摘要）                                    |
| `choice`  | string   | granted 时必填 | 用户选择的选项                                                             |
| `reason`  | string   | denied 时可选  | 用户拒绝原因                                                               |

**产物元数据字段 (artifact_meta)**：

| 子字段       | 类型   | 必填 | 说明                                               |
| ------------ | ------ | ---- | -------------------------------------------------- |
| `type`       | enum   | ✅   | handoff/diagnosis/review-stamp/optimize-report/ctx |
| `size_bytes` | number | ✅   | 文件大小                                           |
| `summary`    | string | ✅   | 一句话摘要（UI 渲染为预览卡片标题）                |

**violation 字段**：

| 子字段     | 类型   | 必填 | 说明                            |
| ---------- | ------ | ---- | ------------------------------- |
| `id`       | string | ✅   | anti-pattern ID（如 AP-2、R-3） |
| `severity` | enum   | ✅   | FATAL/WARN/HARD_STOP            |
| `pattern`  | string | ✅   | 违反的模式名称                  |
| `evidence` | string | ✅   | 具体证据描述                    |

**JSONL 优势**：

- **原子追加**：每行是完整 JSON，不存在行撕裂问题（天然 append-only）
- **流式读取**：`tail -f` + 逐行 JSON.parse，无需等文件完整
- **结构化查询**：`jq 'select(.skill=="review" and .status=="done")'` 精确过滤
- **字段有类型**：`status` 是枚举，`artifact` 是 string|null，AI 不用猜

### 向后兼容

若检测到旧版 `.ritsu/ctx-{YYYY-MM}.md`（pipe-delimited 格式）存在，`ritsu_read_ctx` 工具应同时读取两种格式并合并结果。新写入一律使用 JSONL 格式。

### 读取时机

当用户执行 `/r-route` 或新会话开始时，AI **必须先读取当月最新的** `.ritsu/ctx-{YYYY-MM}.jsonl`（若存在）：

1. 找到最后一条 `status=started` 且没有对应 `done`/`failed` 的记录 → 告知用户"检测到未完成的任务"并询问是否继续
2. 找到最后一条 `status=done` 记录 → 告知用户"上一个任务已完成"并推荐下一步
3. 文件不存在 → 若需查找跨月历史可调用 `ritsu_retrieve_memory`，否则视为全新会话，正常执行

### 会话恢复行为协议 (Session Recovery Protocol)

当检测到未完成任务并用户确认继续时，按以下规则恢复：

1. **定位断点**：读取未完成记录的 `skill`、`step` 和 `progress` 字段
2. **step 级恢复**：查找该 skill 的最后一条 `step_done` 事件，从其 `step` 的下一步开始（如最后完成 `step_done step=2/5`，则从 Step 3 开始）
3. **progress 级恢复**：若 `progress` 标记了 chunk（如 `dev:chunk2/5`），则从 chunk 3 开始
4. **无 step/progress 时**：从该 skill 的 Step 1 重新开始（保守策略，避免跳步导致状态不一致）
5. **恢复后首行输出**：
   ```
   🔄 会话恢复: /r-{skill} | 断点: step {N}/{M} | 领域: {domain}
   ```

### 文件管理与长期记忆检索 (Local RAG)

- `.ritsu/ctx-{YYYY-MM}.jsonl` 只追加，不修改历史记录（append-only）。
- **天然防膨胀**：因采用按月分片路由（Time-based Sharding），单文件体积得到物理遏制。
- **长期记忆回溯**：AI 在执行 `/r-think`、`/r-hunt` 或用户提问时，严禁加载过去数月的 `ctx` 文件。必须使用工具菜单中的 **`ritsu_retrieve_memory`**，传入自然语言关键字，通过底层检索抓取相关的 `handoff`、`diagnosis` 碎片，实现本地 RAG 问答。

### 月度摘要机制 (Monthly Summary)

每月最后一天（或当月 ctx 文件记录超过 50 条时），在 `ritsu_read_ctx` 返回结果中自动附加摘要行：

```jsonl
{
  "ts": "20260531-235900",
  "skill": "_summary",
  "domain": "_all",
  "status": "done",
  "artifact": ".ritsu/ctx-2026-05.jsonl",
  "progress": null,
  "summary": {
    "month": "2026-05",
    "tasks_total": 12,
    "tasks_done": 10,
    "tasks_failed": 2,
    "skills_used": {
      "think": 3,
      "dev": 5,
      "review": 4,
      "hunt": 1,
      "optimize": 2
    },
    "domains": {
      "frontend": 8,
      "backend": 4
    }
  }
}
```

**摘要用途**：

- 跨月会话恢复时，`ritsu_read_ctx` 先读取上月摘要（1 条记录），而非全量历史
- 摘要自动由 `ritsu_read_ctx` 工具在读取时计算生成，无需手动写入
- 超过 3 个月的历史 ctx 文件可由用户决定是否归档删除（摘要已保留关键统计）
