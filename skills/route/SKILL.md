---
name: route
version: "3.4.0"
description: "Ritsu 任务调度入口。分析用户意图，路由至正确技能，建立全局会话上下文。"
when_to_use: "/r-route, 我不知道该用哪个命令, 帮我决定, 从哪开始"
token_budget: 3000
total_steps: 5
hard_constraints:
  - id: HC-1
    rule: "只做调度决策，不执行任何实质性的开发/设计/诊断工作"
    severity: FATAL
  - id: HC-2
    rule: "识别到多个意图时，必须标注次要意图，不得静默丢弃"
    severity: FATAL
---

# Route: 全局任务调度入口 (Global Dispatcher)

**触发条件**：用户输入 `/r-route`，或表达了意图但不确定该调用哪个技能。

## 执行流水线

### 1. 上下文恢复与现实对账 (Context Recovery & Reality Check)

调用 **`ritsu_read_ctx`** 工具解析历史任务状态：

⚠️ **现实对账机制 (Temporal Desync Check)**：

- 如果 ctx 记录上一任务为 `done`（例如开发完成），但你通过文件探查或 Git 状态发现代码实际上并不存在（用户可能执行了 `git reset --hard` 时间回退）。
- **必须触发状态机回拨**：向用户提示"检测到 Git 时空错位，代码已回滚"，主动忽略该 `done` 记录，将状态机自适应拨回 `started`，并询问是否重新执行该任务。

如果没有发生时空错位，按正常逻辑提示：

- 发现未完成任务 → 告知用户"检测到未完成任务"，询问是否继续或开启新任务
- 发现已完成任务 → 告知上一任务结论，推荐下一步
- 无记录 → 正常继续

### 2. 领域解析

> 引用 `_shared/skill-common-steps.md` Step 1

### 3. 意图识别与路由

**单意图路由**（按序，首个命中即路由）：

```
1. 项目全新 / 无 AGENTS.md           → /r-init
2. 有新需求 且 .ritsu/handoff-* 不存在 → /r-think [需求]
3. 直接写代码 且 Handoff 已存在       → /r-dev [handoff路径]
4. 有报错 / 找不到 Bug               → /r-hunt [报错信息]
5. 写完代码 / 要合并                 → /r-review
6. 优化/精简/提速/重构（不改功能）    → /r-opt [目标文件/模块]
7. 有 Issue/PR 要处理               → /r-triage
```

> **dev vs think 分叉依据**：调用 **`ritsu_list_artifacts`**（type=handoff）检查文件是否存在，而非依赖用户描述措辞。

**多意图路由**（识别到 2+ 意图）：

- 主任务优先级：`hunt > review > optimize > dev > think > triage > init`
- 必须在输出中标注：`⚠️ 次要意图：{描述} → 主任务完成后执行 /r-{skill}`

### 4. 生成 correlation_id + 输出路由决策

生成任务链路关联 ID：`cid-{YYYYMMDD}-{seq}`（seq 为当日递增序号，从当月 ctx 文件中查找当日最大 seq +1，若无则从 1 开始）。此 ID 将被同链路所有后续技能继承。

```
[RITSU_CTX: domain={value}, cid={correlation_id}]
🧭 律 (Ritsu) 调度：{意图描述} → /r-{skill}
{若多意图：⚠️ 次要：{描述} → /r-{次要}}
请执行：**`/r-{skill} [...]`**
```

### 5. 写入 transition_event + ctx

路由决策确定后，先写入状态机流转事件（供 UI 渲染状态动画），再写入 ctx：

**transition_event**（追加到 ctx，status=started）：

```jsonl
{
  "ts": "{YYYYMMDD-HHMMSS}",
  "correlation_id": "{cid}",
  "skill": "route",
  "domain": "{value}",
  "status": "started",
  "step": "5/5",
  "artifact": null,
  "progress": null,
  "transition": {
    "from": "route",
    "to": "{target_skill}",
    "event": "{state-machine event name}",
    "ui_hint": "{state-machine ui_hint}"
  }
}
```

> 引用 `_shared/skill-common-steps.md` Step 2（skill=route, artifact=null, correlation_id=步骤4生成的值）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=route）
