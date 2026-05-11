# 情景记忆持久化协议 (Context Protocol)

> Ritsu Bundle 共享协议 v3.6.0
> 解决问题：会话重置后 AI 丢失当前任务上下文（任务在哪一步、领域是什么、产物在哪里）
> v3.6.0 精简：事件流从 10 种收敛为 4 种核心类型，审批/熔断/进度改为 AI 自然语言输出

---

## 协议规则

### 写入时机

每个技能的执行过程中，**按事件类型追加记录**到当月的任务状态文件 `{项目根}/.ritsu/ctx-{YYYY-MM}.jsonl` 中。

### 事件类型 (status 枚举)

| status             | 触发时机                   | 必填附加字段                        |
| ------------------ | -------------------------- | ----------------------------------- |
| `started`          | 技能启动（领域解析完成后） | `step`                              |
| `done`             | 技能完成                   | `step`, `artifact`                  |
| `failed`           | 技能失败                   | `step`, `error`                     |
| `artifact_written` | 产物文件写入完成           | `step`, `artifact`, `artifact_meta` |

> v3.6 移除的事件类型：`step_done`/`step_failed`/`approval_required`/`approval_granted`/`approval_denied`/`circuit_breaker`。审批由 AI 自然语言输出，熔断状态由 `ritsu_read_ctx` 的 `circuit_breaker_status` 自动计算。

### 记录格式（JSONL，每行一个 JSON 对象，追加不覆盖）

**基础示例（4 种核心事件）**：

```jsonl
{"ts":"20260509-145000","correlation_id":"cid-20260509-001","skill":"think","domain":"backend","status":"started","step":"1/4"}
{"ts":"20260509-145030","correlation_id":"cid-20260509-001","skill":"think","domain":"backend","status":"artifact_written","step":"3/4","artifact":".ritsu/handoff-user-login-flow.md","artifact_meta":{"type":"handoff","size_bytes":2340,"summary":"用户登录流程设计，含 5 个实施项"}}
{"ts":"20260509-145040","correlation_id":"cid-20260509-001","skill":"think","domain":"backend","status":"done","step":"4/4","artifact":".ritsu/handoff-user-login-flow.md"}
```

**失败事件示例**：

```jsonl
{
  "ts": "20260509-152000",
  "correlation_id": "cid-20260509-001",
  "skill": "review",
  "domain": "backend",
  "status": "failed",
  "step": "2/3",
  "error": "Hard Stop: AP-2 引用未验证标识符 'useAuth'"
}
```

**字段说明**：

| 字段             | 类型         | 必填 | 说明                                                                              |
| ---------------- | ------------ | ---- | --------------------------------------------------------------------------------- |
| `ts`             | string       | ✅   | `YYYYMMDD-HHMMSS` 格式时间戳                                                      |
| `correlation_id` | string       | ✅   | 任务链路关联 ID（格式 `cid-{YYYYMMDD}-{seq}`），由 route 生成，同链路技能继承     |
| `skill`          | string       | ✅   | 技能名：route/init/think/dev/optimize/review/hunt/triage                          |
| `domain`         | string       | ✅   | 领域值：frontend/backend/fullstack/infra/data                                     |
| `status`         | enum         | ✅   | 见上方事件类型表                                                                  |
| `step`           | string       | ⚠️   | 格式 `{current}/{total}`（如 `2/5`），started/done/failed/artifact_written 时必填 |
| `artifact`       | string\|null |      | 产物文件路径，done/artifact_written 时必填                                        |
| `error`          | string       |      | failed 时必填，一句话错误描述                                                     |
| `artifact_meta`  | object       |      | artifact_written 时必填，见产物元数据                                             |

**产物元数据字段 (artifact_meta)**：

| 子字段       | 类型   | 必填 | 说明                                               |
| ------------ | ------ | ---- | -------------------------------------------------- |
| `type`       | enum   | ✅   | handoff/diagnosis/review-stamp/optimize-report/ctx |
| `size_bytes` | number | ✅   | 文件大小                                           |
| `summary`    | string | ✅   | 一句话摘要（UI 渲染为预览卡片标题）                |

**机器可读 Schema**：本协议的完整 JSON Schema 见 `_shared/ctx-event-schema.json`，可用于 TypeScript 类型生成、运行时校验和 UI 组件 props 推导。

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
3. 文件不存在 → 若需查找跨月历史可调用 `ritsu_exec` 执行 grep 搜索 .ritsu/ 目录，否则视为全新会话，正常执行

### 会话恢复行为协议 (Session Recovery Protocol)

当检测到未完成任务并用户确认继续时，按以下规则恢复：

1. **定位断点**：`ritsu_read_ctx` 返回 `recovery_context`，包含未完成任务的 skill/domain/step 信息
2. **现实对账**：`ritsu_read_ctx` 返回 `reality_check`，检查 handoff/diagnosis 等产物文件是否仍存在于磁盘（git reset --hard 后文件可能丢失）
3. **熔断检测**：`ritsu_read_ctx` 返回 `circuit_breaker_status`，若连续 failed ≥ 2 则 `should_redirect=think`，AI 应先升维再继续
4. **恢复后首行输出**：
   ```
   🔄 会话恢复: /r-{skill} | 断点: step {N}/{M} | 领域: {domain}
   ```

### 文件管理与长期记忆检索 (Local RAG)

- `.ritsu/ctx-{YYYY-MM}.jsonl` 只追加，不修改历史记录（append-only）。
- **天然防膨胀**：因采用按月分片路由（Time-based Sharding），单文件体积得到物理遏制。
- **长期记忆回溯**：AI 在执行 `/r-think`、`/r-hunt` 或用户提问时，严禁加载过去数月的 `ctx` 文件。必须调用 `ritsu_exec` 执行 `grep -rni "{关键字}" .ritsu/ --include="*.md" --include="*.jsonl"`，通过底层检索抓取相关的 `handoff`、`diagnosis` 碎片，实现本地 RAG 问答。

### 月度摘要机制 (Monthly Summary)

每月最后一天（或当月 ctx 文件记录超过 50 条时），在 `ritsu_read_ctx` 返回结果中自动附加摘要行：

```jsonl
{
  "ts": "20260531-235900",
  "correlation_id": null,
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
