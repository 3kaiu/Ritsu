---
name: hunt
version: "3.8.0"
description: "Ritsu 主入口。用于证据收集、假设验证、根因定位和交付恢复。"
when_to_use: "/r-hunt, 报错了, 排障, 诊断, debug, 找不到问题在哪"
total_steps: 5
fast_mode:
  skip_steps: [4]
  skip_artifacts: true
  self_test: null
  description: "在报错信息明确时直接做快速定位与根因倒推"
hard_constraints:
  - id: HC-1
    rule: "确诊前禁止修改任何业务代码"
    severity: FATAL
  - id: HC-2
    rule: "假设必须可验证、可排除，禁止模糊猜测"
    severity: FATAL
  - id: HC-3
    rule: "当现有证据不足时，必须回到取证，而不是硬给结论"
    severity: FATAL
---

# Hunt: 排障与诊断入口

**触发条件**：用户输入 `/r-hunt`，或 `dev / test / review` 遇到原因不明的问题时调用。

## 执行流水线

> 若 runtime 可用，先用 `ritsu_run_flow(flow_id="hunt-recovery")` 建立执行骨架；AI 主要处理证据归纳、根因判断和诊断结论，并在判断位结束后用 `ritsu_apply_flow_decision` 回写。

### 1. 领域解析与上下文绑定

> 引用 `_shared/skill-common-steps.md` Step 1

绑定当前诊断上下文：

- 报错信息
- 最近的 `think-plan / dev-report / review-report`（兼容旧名 `delivery-plan / delivery-report / assurance-report` 同样可读）
- `review-advice`（兼容旧名 `release-advice`）
- `diagnosis` 历史
- 当前 diff
- 失败的 lint/test 输出

### 2. 证据抓取

`[Step 1 Complete]` 后进入步骤 2。

先定义问题边界，再抓证据：

- 当前症状是什么
- 影响路径在哪
- 最可能涉及哪些模块

### 3. 根因假设

`[Step 2 Complete]` 后进入步骤 3。

提出 1-3 个可验证假设，每条都必须包含：

- 假设内容
- 排除条件
- 验证方式

### 4. 探针验证

`[Step 3 Complete]` 后进入步骤 4。

按置信度从高到低逐个验证：

- 命中 -> 锁定根因
- 排除 -> 进入下一条
- 全部排除 -> 回到取证

### 5. 根因结论与诊断产物

`[Step 4 Complete]` 后进入步骤 5。

最终输出必须回答：

- 表象是什么
- 根因是什么
- 证据是什么
- 应该回到 `dev` 还是回到 `think`

如需落盘，调用 `ritsu_write_artifact`（type=diagnosis）。

> 引用 `_shared/skill-common-steps.md` Step 4（skill=hunt）

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=hunt, artifact=.ritsu/diagnosis-{ts}.md）
