---
name: route
version: "3.8.0"
description: "Ritsu 任务调度入口。分析用户意图，路由至正确技能或流水线，建立全局会话上下文。"
when_to_use: "/r-route, 我不知道该用哪个命令, 帮我决定, 从哪开始"
context_window_guidance: 3000
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

⚠️ **现实对账机制**：`ritsu_read_ctx` 自动计算 `reality_check` 字段：

- `desync_detected: true` → 向用户提示"检测到 Git 时空错位，产物文件已丢失"，主动忽略该 `done` 记录，将状态机自适应拨回 `started`，并询问是否重新执行该任务。
- `desync_detected: false` → 按正常逻辑提示。

同时检查 `recovery_context`：

- 存在未完成任务 → 告知用户"检测到未完成任务"，展示 `recovery_context.resume_hint`，询问是否继续或开启新任务
- 发现已完成任务 → 告知上一任务结论，推荐下一步
- 无记录 → 正常继续

同时检查 `circuit_breaker_status`：

- `should_redirect` 非空 → 告知用户"检测到熔断状态（连续 {consecutive_fails} 次失败）"，建议先执行 `/r-think`

### 2. 领域解析

> 引用 `_shared/skill-common-steps.md` Step 1

> 💡 优先调用 `ritsu_get_changed_files` 获取 `domain_hint`，作为领域解析的 P2 依据。

### 3. 意图识别与路由

**单意图路由**（按序，首个命中即路由）：

```
1. 项目全新 / 无 AGENTS.md           → /r-init
2. 有新需求 且 .ritsu/handoff-* 不存在 → /r-pipe standard [需求]（自动 think→dev→review）
3. 直接写代码 且 Handoff 已存在       → /r-dev [handoff路径]
4. 有报错 / 找不到 Bug               → /r-pipe bugfix [报错信息]（自动 hunt→dev→review）
5. 写完代码 / 要合并                 → /r-review
6. 优化/精简/提速/重构（不改功能）    → /r-pipe optimize [目标]（自动 optimize→review）
7. 补测试 / 写测试 / 测试覆盖率       → /r-pipe test_add [目标]（自动 test→review）
8. 部署 / 发布 / 上线                 → /r-deploy
9. 写文档 / 更新文档 / API文档        → /r-doc [目标]
10. 有 Issue/PR 要处理               → /r-triage
```

**流水线路由**（用户明确要求端到端交付时）：

| 流水线             | 触发条件                 | 自动序列             |
| ------------------ | ------------------------ | -------------------- |
| `/r-pipe standard` | 新需求，需设计→开发→审查 | think → dev → review |
| `/r-pipe bugfix`   | Bug 修复                 | hunt → dev → review  |
| `/r-pipe optimize` | 代码优化                 | optimize → review    |
| `/r-pipe test_add` | 补充测试                 | test → review        |

流水线规则（引用 `_shared/state-machine.yaml` states.pipe.rules）：

- 自动传递 correlation_id 和 domain
- 任一技能 failed → 暂停，等待用户决定
- 熔断触发 → 自动重定向至 think
- `/r-pipe --skip` 跳过当前技能
- `/r-pipe --abort` 终止流水线

> **dev vs think 分叉依据**：调用 **`ritsu_list_artifacts`**（type=handoff）检查文件是否存在，而非依赖用户描述措辞。

**多意图路由**（识别到 2+ 意图）：

- 主任务优先级：`hunt > review > optimize > dev > think > triage > init`
- 必须在输出中标注：`⚠️ 次要意图：{描述} → 主任务完成后执行 /r-{skill}`

### 4. 输出路由决策

```
[RITSU_CTX: domain={value}]
🧭 律 (Ritsu) 调度：{意图描述} → /r-{skill}
{若多意图：⚠️ 次要：{描述} → /r-{次要}}
请执行：**`/r-{skill} [...]`**
```

> correlation_id 由 `ritsu_emit_event` 自动生成（格式 `cid-{YYYYMMDD}-{seq}`），无需手动指定。

### 5. 写入 ctx

路由决策确定后，写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=route, artifact=null）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=route）
