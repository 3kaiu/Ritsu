# 情景记忆持久化协议 (Context Protocol)
> Ritsu Bundle 共享协议 v3.0
> 解决问题：会话重置后 AI 丢失当前任务上下文（任务在哪一步、领域是什么、产物在哪里）

---

## 协议规则

### 写入时机
每个技能的"关联流转"步骤执行时，**必须追加一条记录**到 `{项目根}/ritsu/ctx.md`：

- **技能启动时**（领域解析完成后）追加 `started` 记录
- **技能完成时**追加 `done` 记录
- **技能被中断/失败时**追加 `failed` 记录

### 记录格式（每条一行，追加不覆盖）
```
{YYYYMMDD-HHMMSS} | {skill} | domain={value} | {started|done|failed} | {artifact-path|none}
```

示例：
```
20260509-145000 | think | domain=backend | started | none
20260509-150233 | think | domain=backend | done | ritsu/handoff-user-login-flow.md
20260509-150240 | dev   | domain=backend | started | none
20260509-151822 | dev   | domain=backend | done | none
20260509-151825 | review| domain=backend | started | none
20260509-152044 | review| domain=backend | done | ritsu/review-stamp-20260509-152044.md
```

### 读取时机
当用户执行 `/r-route` 或新会话开始时，AI **必须先读取** `ritsu/ctx.md`（若存在）：
1. 找到最后一条 `started` 且没有对应 `done`/`failed` 的记录 → 告知用户"检测到未完成的任务"并询问是否继续
2. 找到最后一条 `done` 记录 → 告知用户"上一个任务已完成"并推荐下一步
3. 文件不存在 → 全新会话，正常执行

### 文件管理
- `ritsu/ctx.md` 只追加，不修改历史记录（append-only）
- 单个项目的 `ctx.md` 超过 200 行时，提示用户执行归档：`mv ritsu/ctx.md ritsu/ctx-archive-{date}.md`
