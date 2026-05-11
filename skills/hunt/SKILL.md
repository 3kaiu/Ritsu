---
name: hunt
version: "3.8.0"
description: "Ritsu 交付诊断子模块。为 bugfix 和验证失败场景提供证据收集、假设验证和根因定位。"
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

# Hunt: Deliver 诊断子模块 (Bugfix Investigation Module)

**触发条件**：用户输入 `/r-hunt`，或 `deliver` 在 bugfix / 验证失败路径中调用。

> 该模块现在主要服务于交付恢复，而不是独立产品入口。

## 执行流水线

### 1. 领域解析与上下文绑定

> 引用 `_shared/skill-common-steps.md` Step 1

绑定当前诊断上下文：

- 报错信息
- diagnosis 历史
- 当前 diff
- 失败的 lint/test 输出

### 2. 证据抓取

`[Step 1 Complete]` 后进入步骤 2。

先定义问题边界，再抓证据：

- 当前症状是什么
- 影响路径在哪
- 最可能涉及哪些模块

历史案例召回、semantic 检索、KG、sandbox 都只能作为增强手段；它们的职责是加速取证，不是直接代替结论。

### 3. 根因假设

`[Step 2 Complete]` 后进入步骤 3。

提出 1-3 个可验证假设，每条都必须包含：

- 假设内容
- 排除条件
- 验证方式

### 4. 探针验证

`[Step 3 Complete]` 后进入步骤 4。

按置信度从高到低逐个验证：

- 命中 → 锁定根因
- 排除 → 进入下一条
- 全部排除 → 回到取证

### 5. 根因结论与诊断产物

`[Step 4 Complete]` 后进入步骤 5。

最终输出必须回答：

- 表象是什么
- 根因是什么
- 证据是什么
- 应该回到 `dev` 还是升级到 `think`

如需落盘，调用 `ritsu_write_artifact`（type=diagnosis）。

> 引用 `_shared/skill-common-steps.md` Step 4（skill=hunt）

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=hunt, artifact=.ritsu/diagnosis-{ts}.md）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=hunt）
