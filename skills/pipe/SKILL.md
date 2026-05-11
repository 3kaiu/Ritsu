---
name: pipe
version: "3.8.0"
description: "Ritsu 流水线编排引擎。按预设序列自动衔接技能，传递上下文，追踪进度。"
when_to_use: "/r-pipe, 端到端交付, 从头到尾, 一条龙, 全流程"
total_steps: 4
hard_constraints:
  - id: HC-1
    rule: "流水线内技能必须严格按序列执行，禁止跳过或乱序（--skip 除外）"
    severity: FATAL
  - id: HC-2
    rule: "任一技能 failed 时必须暂停，等待用户决定，禁止自动跳过失败技能"
    severity: FATAL
  - id: HC-3
    rule: "熔断触发时必须自动重定向至 think，禁止继续流水线"
    severity: FATAL
---

# Pipe: 流水线编排引擎 (Pipeline Orchestrator)

**触发条件**：用户输入 `/r-pipe {pipeline_name}`，或由 `/r-route` 路由至流水线模式。

## 预设流水线

引用 `_shared/state-machine.yaml` states.pipe.pipelines 定义：

| 流水线名   | 触发场景             | 技能序列             |
| ---------- | -------------------- | -------------------- |
| `standard` | 新需求，需设计→开发→审查 | think → dev → review |
| `bugfix`   | Bug 修复             | hunt → dev → review  |
| `optimize` | 代码优化             | optimize → review    |
| `test_add` | 补充测试             | test → review        |

## 执行流水线

### 1. 流水线初始化

> 引用 `_shared/skill-common-steps.md` Step 0 + Step 1

`[Step 1 Complete]` 后确定流水线类型：

- **用户指定**（如 `/r-pipe standard`）→ 直接使用
- **用户未指定** → 根据意图推断：
  - 新需求 → standard
  - 报错/Bug → bugfix
  - 优化/精简 → optimize
  - 补测试 → test_add
- **无法推断** → 询问用户选择

输出流水线计划：

```
🔧 流水线: {pipeline_name}（共 {N} 步）
  Step 1/{N}: /r-{skill_1} — {技能用途}
  Step 2/{N}: /r-{skill_2} — {技能用途}
  ...
  Step {N}/{N}: /r-{skill_N} — {技能用途}

执行模式: {standard|fast（每技能按其 fast_mode 声明）}
```

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=pipe, artifact=null）

### 2. 逐技能执行（HC-1 执行协议）

`[Step 1 Complete]` 后按序列逐个执行技能。

**每个技能的执行协议**：

```
─── 流水线进度: Step {current}/{total} — /r-{skill} ───

1. 执行当前技能的 SKILL.md 定义的全部步骤
2. 技能完成后检查结果：
   ✅ done → 输出技能交付摘要，推进到下一步
   ❌ failed → 暂停流水线（HC-2），向用户展示：
      "⚠️ /r-{skill} 执行失败：{error}
       选择：[C]继续下一步 / [R]重试当前技能 / [T]熔断升维→/r-think / [A]终止流水线"
   🔥 熔断 → 自动重定向至 /r-think（HC-3），流水线暂停
```

**上下文传递规则**：

- 自动传递 `correlation_id` 和 `domain`，无需重新解析
- 上游技能的产物文件自动作为下游技能的输入：
  - think → handoff-*.md → dev 自动绑定
  - hunt → diagnosis-*.md → dev 自动绑定
  - dev → 代码变更 → review 自动抓取 diff
  - optimize → 代码变更 → review 自动抓取 diff
  - test → 测试文件 → review 自动抓取 diff
- 每个技能完成后输出精简摘要（1-3 行），不重复输出完整交付清单

**fast 模式下的技能执行**：

- `/r-pipe --fast`：流水线中每个技能按其 `fast_mode` 声明执行
- 无 `fast_mode` 声明的技能按 standard 执行
- fast 模式下技能间不输出详细步骤，仅输出关键结果

### 3. 流水线控制指令

用户可在流水线执行过程中随时发出控制指令：

| 指令 | 效果 |
| --- | --- |
| `/r-pipe --skip` | 跳过当前技能，推进到下一步 |
| `/r-pipe --abort` | 终止流水线，输出已完成步骤摘要 |
| `/r-pipe --fast` | 切换后续技能为 fast 模式 |
| `/r-pipe --standard` | 切换后续技能为 standard 模式 |

> 控制指令通过自然语言识别，用户无需精确输入指令格式。如"跳过这步"、"停"、"加速"均可识别。

### 4. 流水线完成与交付总览

`[所有技能执行完成]` 后输出交付总览：

```markdown
## 🔧 流水线交付总览: {pipeline_name}

| Step | 技能 | 状态 | 关键产出 |
| --- | --- | --- | --- |
| 1/{N} | /r-{skill_1} | ✅/❌ | {产物或摘要} |
| 2/{N} | /r-{skill_2} | ✅/❌ | {产物或摘要} |
| ... | ... | ... | ... |

- 总耗时技能: {N}
- 成功: {M} | 失败: {K} | 跳过: {L}
- 产物文件: {列出 .ritsu/ 下新增的所有产物}
- 溯源链路: correlation_id={cid}
```

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=pipe, artifact=null）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=pipe）
