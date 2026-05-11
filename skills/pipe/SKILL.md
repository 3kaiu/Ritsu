---
name: pipe
version: "3.8.0"
description: "Ritsu 交付主入口。按任务风险选择 quick / standard / critical 模式，推进从实现到验证的交付闭环。"
when_to_use: "/r-pipe, 端到端交付, 从头到尾, 一条龙, 全流程"
total_steps: 4
hard_constraints:
  - id: HC-1
    rule: "交付必须遵循已判定的任务模式和风险边界，禁止擅自扩大范围"
    severity: FATAL
  - id: HC-2
    rule: "任一关键验证 failed 时必须暂停，等待用户决定，禁止自动忽略失败继续交付"
    severity: FATAL
  - id: HC-3
    rule: "高风险或连续失败时必须升格到更重模式或回到设计，不得假装已完成"
    severity: FATAL
---

# Pipe: Deliver 交付主入口 (Delivery Orchestrator)

**触发条件**：用户输入 `/r-pipe`，或由 `/r-route` 路由至交付阶段。

> 当前文件名仍为 `pipe`，但产品语义上承担 `deliver`。

## 交付模式

`deliver` 不再强调“很多预设流水线”，而是统一暴露三种模式：

| 模式 | 适用场景 | 默认内部路径 |
| --- | --- | --- |
| `quick` | 微小改动、低风险、上下文明确 | dev → 基本验证 → assure |
| `standard` | 常规需求 / 常规 bugfix | think/hunt → dev → test → assure |
| `critical` | 架构变更 / 迁移 / 高发布风险 | think → dev 分批 → test → assure |

## 执行流水线

### 1. 交付初始化

> 引用 `_shared/skill-common-steps.md` Step 0 + Step 1

`[Step 1 Complete]` 后确定交付模式：

- **用户指定** → 直接使用
- **用户未指定** → 根据 intake 结果或当前任务风险推断
- **无法推断** → 询问用户选择

输出交付计划：

```markdown
## Deliver 计划
- 模式: {quick|standard|critical}
- 目标: {一句话任务描述}
- 风险边界: {一句话}
- 核心验证: {lint/test/手工验证/契约核对}
- 预计路径: {内部阶段列表}
```

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=pipe, artifact=null）

### 2. 按模式推进交付

`[Step 1 Complete]` 后，不要求用户理解每个内部 skill，而由 `deliver` 自行选择适当阶段。

**quick 模式**：

1. 直接进入实现
2. 执行最小必要验证
3. 输出交付摘要
4. 交给 assure 判断是否可合并

**standard 模式**：

1. 先做范围澄清
2. 进入实现
3. 做验证与补测
4. 汇总交付结果
5. 交给 assure 做验收结论

**critical 模式**：

1. 强制边界和契约澄清
2. 强制说明风险与回滚
3. 必要时分批实现
4. 强制执行关键验证
5. 交给 assure 做阻断式验收

**上下文传递规则**：

- 自动传递 `correlation_id` 和 `domain`
- 内部模块可按任务需要调用 `think / dev / test / hunt`
- 用户看到的是交付进度和风险状态，而不是内部技能细节

### 3. 交付控制指令

用户可在交付过程中随时发出控制指令：

| 指令 | 效果 |
| --- | --- |
| `/r-pipe --abort` | 终止本次交付 |
| `/r-pipe --fast` | 尽量降低后续交互和输出密度 |
| `/r-pipe --standard` | 回到标准交付策略 |
| `/r-pipe --critical` | 升格为高风险交付策略 |

> 控制指令通过自然语言识别，用户无需精确输入指令格式。

### 4. 交付完成与交付总览

`[交付阶段完成]` 后输出总览：

```markdown
## 🔧 Deliver 交付总览
- 模式: {quick|standard|critical}
- 任务目标: {一句话}
- 实施结果: {完成/部分完成/失败}
- 验证结果: {通过/部分通过/失败}
- 主要产出: {代码/测试/文档/诊断}
- 已知风险: {若无则写“无”}
- 下一步: {进入 assure / 回到 deliver / 回到设计}
- 溯源链路: correlation_id={cid}
```

随后调用 **`ritsu_write_artifact`**（type=`delivery-report`）写入主交付产物，内容至少包含：

- 交付摘要
- 变更与风险
- 下一步

`delivery-report` 是对本次交付结果的正式归档；若内部仍产出 `handoff / diagnosis`，它们属于交付过程证据，不替代最终交付回执。

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=pipe, artifact=.ritsu/delivery-report-{ts}.md）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=pipe）
