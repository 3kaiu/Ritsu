---
name: deploy
version: "3.8.0"
description: "Ritsu 扩展模块。用于部署、冒烟验证和回滚准备，建立在 assure 结论之上。"
when_to_use: "/r-deploy, 部署, 发布, 上线, deploy, release, 推到生产"
total_steps: 5
fast_mode:
  skip_steps: [1, 2]
  skip_artifacts: false
  self_test: null
  description: "在前置条件明确时直接部署并做冒烟验证"
hard_constraints:
  - id: HC-1
    rule: "部署前必须有明确的验收结论，或用户显式接受跳过验收的风险"
    severity: FATAL
  - id: HC-2
    rule: "必须有可执行的回滚方案"
    severity: FATAL
  - id: HC-3
    rule: "预发布检查未通过时禁止继续部署"
    severity: FATAL
---

# Deploy: Extensions 发布模块 (Deployment Extension)

**触发条件**：用户输入 `/r-deploy`，或 assure 结论明确后进入上线动作。

> 该模块属于扩展能力，不属于主链路一线入口。

## 执行流水线

### 1. 验收状态确认

> 引用 `_shared/skill-common-steps.md` Step 1

确认最近的验收状态：

- mergeable / deployable
- deployable_with_risk
- 无验收记录

无明确结论时，不默认直接上线。

### 2. 预发布检查

`[Step 1 Complete]` 后进入步骤 2。

检查：

- 版本一致性
- 工作区状态
- 环境变量和配置
- 迁移可逆性
- 发布说明或版本记录

### 3. 回滚方案确认

`[Step 2 Complete]` 后进入步骤 3。

必须给出明确回滚指令：

- 代码回滚
- 数据回滚
- 重部署
- 回滚后验证

### 4. 部署与冒烟验证

`[Step 3 Complete]` 后进入步骤 4。

按项目定义执行部署，并完成最小冒烟：

- 健康检查
- 关键路径可达
- 日志无明显致命错误

若冒烟失败，立即执行回滚路径。

### 5. 交付摘要

`[Step 4 Complete]` 后进入步骤 5。

> 引用 `_shared/skill-common-steps.md` Step 4（skill=deploy）

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=deploy, artifact=null）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=deploy）
