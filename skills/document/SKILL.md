---
name: document
version: "3.8.0"
description: "Ritsu 扩展模块。用于维护 README、API 文档、CHANGELOG 和注释，不属于默认交付链路。"
when_to_use: "/r-doc, 写文档, 更新文档, API文档, CHANGELOG, README, JSDoc"
total_steps: 4
fast_mode:
  skip_steps: [2]
  skip_artifacts: true
  self_test: null
  description: "直接生成或更新目标文档"
hard_constraints:
  - id: HC-1
    rule: "文档必须与代码实际行为一致"
    severity: FATAL
  - id: HC-2
    rule: "文档内容不得包含占位符"
    severity: FATAL
  - id: HC-3
    rule: "不得修改业务代码，只修改文档与注释"
    severity: WARN
---

# Document: Extensions 文档模块 (Documentation Extension)

**触发条件**：用户输入 `/r-doc`，或交付完成后需要补文档时调用。

> 该模块属于扩展能力，不属于默认交付链路的一线入口。
> 它通常挂在某次 `think/dev/review` 交付之后，用来补齐主链路已经确认的事实，不应反向改写交付结论。

## 执行流水线

### 1. 文档目标识别

> 引用 `_shared/skill-common-steps.md` Step 1

识别本次目标：

- API 文档
- README
- CHANGELOG
- JSDoc / TSDoc

### 2. 代码与文档对账

`[Step 1 Complete]` 后进入步骤 2。

通过代码扫描确认：

- 路由、接口、类型是否真实存在
- 现有文档是否过时
- 变更项是否已被记录

### 3. 文档更新

`[Step 2 Complete]` 后进入步骤 3。

更新目标文档，确保：

- 描述和代码一致
- 参数和签名对齐
- 不制造占位或伪功能描述

### 4. 交付摘要

`[Step 3 Complete]` 后进入步骤 4。

> 引用 `_shared/skill-common-steps.md` Step 4（skill=document）

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=document, artifact=null）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=document）
