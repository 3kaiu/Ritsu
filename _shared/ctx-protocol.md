# 情景记忆持久化协议 (Context Protocol)

> Ritsu Bundle 共享协议 v3.8.0
> 解决问题：会话重置后 AI 丢失当前任务上下文（任务在哪一步、领域是什么、产物在哪里）
> 事件流仅保留 4 种核心类型（started/done/failed/artifact_written），审批/熔断/进度通过 AI 自然语言输出

---

## 协议规则

### 写入时机

每个技能的执行过程中，**按事件类型追加记录**到当月的任务状态文件 `{项目根}/.ritsu/ctx-{YYYY-MM}.jsonl` 中。

### 事件类型 (status 枚举)

4 种核心事件：`started` / `done` / `failed` / `artifact_written`

> 完整字段定义、类型约束和条件必填规则见 `_shared/ctx-event-schema.json`（单一真相源）。本文件不再重复声明。

### 记录格式

JSONL（每行一个 JSON 对象，追加不覆盖）。示例见 `_shared/ctx-event-schema.json`。

### 读取时机

当用户执行 `/r-route`（当前承担 intake）或新会话开始时，AI **必须先读取当月最新的** `.ritsu/ctx-{YYYY-MM}.jsonl`（若存在）：

1. 找到最后一条 `status=started` 且没有对应 `done`/`failed` 的记录 → 告知用户"检测到未完成的任务"并询问是否继续
2. 找到最后一条 `status=done` 记录 → 告知用户"上一个任务已完成"并推荐下一步
3. 文件不存在 → 若需查找跨月历史可调用 `ritsu_exec` 执行 grep 搜索 .ritsu/ 目录，否则视为全新会话，正常执行

### 会话恢复行为协议 (Session Recovery Protocol)

当检测到未完成任务并用户确认继续时，按以下规则恢复：

1. **定位断点**：`ritsu_read_ctx` 返回 `recovery_context`，包含未完成任务的 skill/domain/step 信息
2. **现实对账**：`ritsu_read_ctx` 返回 `reality_check`，检查 handoff/diagnosis 等产物文件是否仍存在于磁盘（git reset --hard 后文件可能丢失）
3. **熔断检测**：`ritsu_read_ctx` 返回 `circuit_breaker_status`。当前产品语义上应理解为“先回到 intake 或升级交付模式”，即使底层旧字段仍可能表现为 `think`
4. **恢复后首行输出**：
   ```
   🔄 会话恢复: /r-{skill} | 断点: step {N}/{M} | 领域: {domain}
   ```

### 文件管理与长期记忆检索 (Local RAG)

- `.ritsu/ctx-{YYYY-MM}.jsonl` 只追加，不修改历史记录（append-only）。
- **天然防膨胀**：因采用按月分片路由（Time-based Sharding），单文件体积得到物理遏制。
- **长期记忆回溯**：AI 在执行 `/r-think`、`/r-hunt` 或用户提问时，严禁加载过去数月的 `ctx` 文件。必须调用 `ritsu_exec` 执行 `grep -rni "{关键字}" .ritsu/ --include="*.md" --include="*.jsonl"`，通过底层检索抓取相关的 `handoff`、`diagnosis` 碎片，实现本地 RAG 问答。

### 月度归档机制 (Monthly Archival)

当月 ctx 文件记录超过 100 条时，`ritsu_read_ctx` 在返回结果中附加提示：

```
💡 当月 ctx 记录已超过 100 条，建议归档旧记录以保持检索性能。
   归档方式：将旧文件移动至 .ritsu/archive/ 目录。
```

- 超过 3 个月的历史 ctx 文件可由用户决定是否归档或删除
- `ritsu_read_ctx` 默认只读取当月和上月 ctx 文件，跨月回溯需用户明确指示
