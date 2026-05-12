# 情景记忆持久化协议 (Context Protocol)

> Ritsu Bundle 共享协议 v3.8.0
> 解决问题：会话重置后 AI 丢失当前任务上下文（任务在哪一步、是谁在做、产物在哪里）
> 事件流只保留 4 种核心类型：`started / done / failed / artifact_written`
>
> 自 v3.8 起，交付流程恢复不只看 `ctx`，还会看 `.ritsu/flows/*.json` 中的 flow state。

---

## 协议规则

### 写入时机

每个技能的执行过程中，按事件类型追加记录到当月状态文件：

`{项目根}/.ritsu/ctx-{YYYY-MM}.jsonl`

### 事件类型

4 种核心事件：`started` / `done` / `failed` / `artifact_written`

> 完整字段定义、类型约束和条件必填规则见 `_shared/ctx-event-schema.json`。本文件不重复声明。

### 记录格式

JSONL（每行一个 JSON 对象，追加不覆盖）。

`skill` 字段默认记录实际工作技能名：

- `think`
- `dev`
- `test`
- `hunt`
- `review`
- `read`
- `deploy`
- `document`
- `triage`
- `optimize`
- `refactor`

只有在读取旧历史时，才可能遇到 legacy alias：

- `route` -> 视为旧版 `think`
- `pipe` -> 视为旧版编排入口，读取时按接近的开发阶段理解

当 `status=artifact_written` 时，`artifact_meta.type` 应优先填写对外首选 alias（如 `think-ticket / think-plan / dev-report / review-report / review-advice`）；若同时知道 canonical 旧名，建议补充 `artifact_meta.canonical_type`。`ritsu_emit_event` 在收到旧主产物名时会自动把 `type` 归一到 alias，并补齐 `canonical_type`。若当前调用方已知层级，建议同时补充 `artifact_meta.layer`：

- `primary` = `think-ticket / think-plan / dev-report / review-report / review-advice`（兼容旧名 `intake-ticket / delivery-plan / delivery-report / assurance-report / release-advice`）
- `evidence` = `handoff / diagnosis / optimize-report`
- `compatibility` = `review-stamp`
- `system` = `ctx`

### 读取时机

当用户执行任一主工作流技能，或新会话开始时，AI 必须先读取当月最新的 `.ritsu/ctx-{YYYY-MM}.jsonl`（若存在）：

1. 找到最后一条 `status=started` 且没有对应 `done`/`failed` 的记录 -> 告知用户“检测到未完成任务”并询问是否继续
2. 找到最后一条 `status=done` 记录 -> 告知用户“上一个任务已完成”并推荐下一步
3. 文件不存在 -> 若需查找跨月历史可调用 `ritsu_exec` 搜索 `.ritsu/`，否则视为全新会话

### 会话恢复行为协议

当检测到未完成任务并用户确认继续时，按以下规则恢复：

1. **定位断点**：`ritsu_read_ctx` 返回 `last_incomplete` / `last_completed` / `recovery_context` / `recent_entries` / `recent_entries_pruned`
2. **现实对账**：`ritsu_read_ctx` 返回 `reality_check`，检查 handoff / diagnosis 等产物是否仍存在
3. **熔断检测**：`ritsu_read_ctx` 返回 `circuit_breaker_status`
4. **流程恢复**：若存在 `.ritsu/flows/*.json`，优先结合 `ritsu_get_flow_state` 查看 `current_step / verification_status / recovery_point`
5. **判断位提交**：若当前 flow state 停在 `awaiting_ai`，应使用 `ritsu_apply_flow_decision` 提交该 step 的 decision 结果，而不是重新开一条新的 flow run
6. **恢复后首行输出**：
   ```text
   🔄 会话恢复: {stage} ({skill}) | 断点: step {N}/{M} | 领域: {domain}
   ```

其中：

- `stage` 用于给出当前应回到的显式工作技能
- `skill` 保留原始 ctx 记录值，便于审计
- 若遇到 `route / pipe`，应明确标注为 legacy 记录，不作为当前推荐入口

### 文件管理与长期记忆检索

- `.ritsu/ctx-{YYYY-MM}.jsonl` 只追加，不修改历史记录
- `.ritsu/flows/{run_id}.json` 记录交付流程状态，用于恢复当前 flow run
- flow state 中的 `correlation_id` 应与同一任务在 `.ritsu/ctx-{YYYY-MM}.jsonl` 里的 `started / artifact_written / done / failed` 事件一致
- 按月分片，避免单文件失控膨胀
- 当 AI 在执行 `/r-think`、`/r-hunt` 或用户提问时，严禁直接粗暴加载过去数月的 ctx 文件
- 若已构建语义索引，优先调用 `ritsu_semantic_search` 或 `ritsu_semantic_graph_rerank`
- 默认先查 `layers=["primary"]`，主产物信息不足时再扩到 `layers=["evidence"]`
- 仅在没有索引或需要底层兜底时，才调用：
  `ritsu_exec("grep -rni ... .ritsu/")`

### 月度归档机制

当月 ctx 文件记录超过 100 条时，`ritsu_read_ctx` 在返回结果中附加提示：

```text
💡 当月 ctx 记录已超过 100 条，建议归档旧记录以保持检索性能。
   归档方式：将旧文件移动至 .ritsu/archive/ 目录。
```

- 超过 3 个月的历史 ctx 文件可由用户决定是否归档或删除
- `ritsu_read_ctx` 默认只读取当月和上月 ctx 文件，跨月回溯需用户明确指示
