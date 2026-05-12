---
name: deploy
version: "3.8.0"
description: "Ritsu 辅助入口。用于部署、冒烟验证和回滚准备，建立在 review 结论之上。"
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

# Deploy: 发布入口

**触发条件**：用户输入 `/r-deploy`，或 `review` 已明确允许进入上线动作时调用。  

> 它属于 `review` 之后的扩展动作，不替代默认验收流程；部署前应先对齐最近一次 `review` 相关产物和 flow state。

优先读取：

- `review-report`（兼容旧名 `assurance-report`）
- `review-advice`（兼容旧名 `release-advice`）
- `dev-report`（兼容旧名 `delivery-report`）

若不存在 `review-advice`（或兼容旧名 `release-advice`），但本次部署涉及灰度、放量、跨角色协作或复杂回滚窗口，应先回到 `review` 补齐发布建议。
