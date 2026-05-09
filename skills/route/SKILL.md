---
name: route
version: "3.0.0"
description: "Ritsu 任务调度入口。分析用户意图，路由至正确技能，建立全局会话上下文。"
when_to_use: "/r-route, 我不知道该用哪个命令, 帮我决定, 从哪开始"
hard_constraints:
  - id: HC-1
    rule: "只做调度决策，不执行任何实质性的开发/设计/诊断工作"
    severity: FATAL
  - id: HC-2
    rule: "识别到多个意图时，必须标注次要意图，不得静默丢弃"
    severity: FATAL
---

# Route: 全局任务调度入口 (Global Dispatcher)

## ⚡ 执行前必读
| ID | 约束 | 违反后果 |
|----|------|---------|
| HC-1 | 只做调度，调度完成后立即停止 | 终止，重新执行 |
| HC-2 | 多意图必须全部标注 | 终止，重新输出 |

---

**触发条件**：用户输入 `/r-route`，或表达了意图但不确定该调用哪个技能。

## 执行流水线

### 1. 上下文恢复（先行）
调用 **`ritsu_read_ctx`** 工具：
- 发现未完成任务 → 告知用户"检测到未完成任务"，询问是否继续或开启新任务
- 发现已完成任务 → 告知上一任务结论，推荐下一步
- 无记录 → 正常继续

### 2. 领域解析
> 引用 `_shared/domain-resolver.md`，输出 `[RITSU_CTX: domain={value}]`

### 3. 意图识别与路由

**单意图路由**（按序，首个命中即路由）：
```
1. 项目全新 / 无 AGENTS.md           → /r-init
2. 有新需求 且 ritsu/handoff-* 不存在 → /r-think [需求]
3. 直接写代码 且 Handoff 已存在       → /r-dev [handoff路径]
4. 有报错 / 找不到 Bug               → /r-hunt [报错信息]
5. 写完代码 / 要合并                 → /r-review
6. 有 Issue/PR 要处理               → /r-triage
```

> **dev vs think 分叉依据**：调用 **`ritsu_list_artifacts`**（type=handoff）检查文件是否存在，而非依赖用户描述措辞。

**多意图路由**（识别到 2+ 意图）：
- 主任务优先级：`hunt > review > dev > think > triage > init`
- 必须在输出中标注：`⚠️ 次要意图：{描述} → 主任务完成后执行 /r-{skill}`

### 4. 输出路由决策
```
[RITSU_CTX: domain={value}]
🧭 律 (Ritsu) 调度：{意图描述} → /r-{skill}
{若多意图：⚠️ 次要：{描述} → /r-{次要}}
请执行：**`/r-{skill} [...]`**
```

### 5. 写入 ctx.md
调用 **`ritsu_write_artifact`**（type=ctx）追加：
```
{timestamp} | route | domain={value} | done | none
```

---

## ⛔ 尾部锚点
**HC-1 最终提醒**：输出路由决策后立即停止。不执行被路由技能的任何步骤。

## 关联流转
> 引用 `_shared/state-machine.md` — route 完成引导语。
