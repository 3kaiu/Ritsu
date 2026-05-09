# 情景记忆持久化协议 (Context Protocol)

> Ritsu Bundle 共享协议 v3.3.1
> 解决问题：会话重置后 AI 丢失当前任务上下文（任务在哪一步、领域是什么、产物在哪里）

---

## 协议规则

### 写入时机

每个技能的"关联流转"步骤执行时，**必须追加一条记录**到当月的任务状态文件 `{项目根}/.ritsu/ctx-{YYYY-MM}.jsonl` 中（例如 `.ritsu/ctx-2026-05.jsonl`）。

- **技能启动时**（领域解析完成后）追加 `started` 记录
- **技能完成时**追加 `done` 记录
- **技能被中断/失败时**追加 `failed` 记录

### 记录格式（JSONL，每行一个 JSON 对象，追加不覆盖）

```jsonl
{"ts":"20260509-145000","skill":"think","domain":"backend","status":"started","artifact":null,"progress":null}
{"ts":"20260509-150233","skill":"think","domain":"backend","status":"done","artifact":".ritsu/handoff-user-login-flow.md","progress":null}
{"ts":"20260509-150240","skill":"dev","domain":"backend","status":"started","artifact":null,"progress":"dev:chunk1/3"}
{"ts":"20260509-151822","skill":"dev","domain":"backend","status":"done","artifact":null,"progress":null}
{"ts":"20260509-151825","skill":"review","domain":"backend","status":"started","artifact":null,"progress":null}
{"ts":"20260509-152044","skill":"review","domain":"backend","status":"done","artifact":".ritsu/review-stamp-20260509-152044.md","progress":null}
```

**字段说明**：

| 字段       | 类型         | 必填 | 说明                                                                                  |
| ---------- | ------------ | ---- | ------------------------------------------------------------------------------------- |
| `ts`       | string       | ✅   | `YYYYMMDD-HHMMSS` 格式时间戳                                                          |
| `skill`    | string       | ✅   | 技能名：route/init/think/dev/optimize/review/hunt/triage                              |
| `domain`   | string       | ✅   | 领域值：frontend/backend/fullstack/infra/data                                         |
| `status`   | enum         | ✅   | `started` / `done` / `failed`                                                         |
| `artifact` | string\|null | ✅   | 产物文件路径，无则为 `null`                                                           |
| `progress` | string\|null |      | 执行进度标记（如 `dev:chunk2/5`），仅 `started` 状态需要，`done`/`failed` 时为 `null` |

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
