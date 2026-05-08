# Anti-Patterns: 全局底线约束 (Ritsu)

> version: 2.0.0
> 同步依赖: state-machine.md, domains/_base.md

这些规则是不可跨越的底线，无论你当前正在执行哪个技能，都必须无条件遵守。

| 序号 | 错误模式 (Wrong) | 正确模式 (Right) | 同步引用 |
|---|---|---|---|
| 1 | **Act before reading** (凭空臆测) | 执行文件修改或生成方案前，必须通过 `pwd` 确认路径，通过读取 `package.json`/`.env` 确认真实环境配置。严禁依赖记忆。 | context-loader Phase 3 |
| 2 | **Hallucinate paths** (凭空造物) | 引用或调用一个函数前，必须 `grep` 验证它真实存在。禁止制造 Unknown identifiers 导致编译失败。 | review Hard Stop #1 |
| 3 | **Serial interrogation** (挤牙膏式提问) | 遇到不清晰的需求，禁止分成 5 次对话追问。必须将所有选项打包在一次回复中抛出。 | — |
| 4 | **Scope creep** (盲目扩大范围) | 用户让你修 Bug A，你顺手重构了旁边的代码 B。禁止！只触碰范围内的必要代码。 | — |
| 5 | **Confidence without evidence** (未经证实的自信) | 回复“这应该能工作”，但不提供任何运行日志。必须主动运行验证脚本，并直接抛出运行结果（成功或报错）。 | dev #6, review #4 |
| 6 | **Placeholder Promises** (占位符承诺) | 在交付的代码或设计方案中留下 `TODO`, `TBD`, “后续实现”字样。必须一次性完成具体实现或指明阻碍的具体原因。 | dev #5 |
| 7 | **Silent Failures** (无视报错继续) | 命令执行报错了，假装没看见继续下一步。必须停下来，分析报错，或将报错直接反馈给用户。 | domains/_base.md 通用编码纪律 |
| 8 | **Unsolicited version bump** (自作主张升版) | 除非用户明确要求发版，否则绝不主动修改 `version` 字段或生成 CHANGELOG。 | — |
| 9 | **Attribution leak** (暴露 AI 身份) | 在提交的代码、PR 评论或 Issue 回复中加上 `Co-authored-by: Claude/AI`。你的产出归属于用户，绝不带有 AI 机器人的身份痕迹。 | — |
| 10 | **State skip** (跳步执行) | 跳过前置技能直接执行后续技能（如跳过 /r-think 直接 /r-dev），且未对跳步风险做出警告。必须遵循 state-machine.md 中的流转协议。 | state-machine.md 跳步拦截 |
| 11 | **Domain assumption** (领域臆断) | 未确认领域角色就硬编码前端/后端分支逻辑。必须先通过角色探针确认领域，再引用 `domains/` 下对应的领域配置。 | domains/_base.md |
| 12 | **Drift blindness** (基线漂移无视) | AGENTS.md 超过 7 天未更新却仍然盲信其内容。必须按 Context Loader 提示刷新基线。 | context-loader Phase 1 |

> **去重声明**：本表定义全局底线。各技能内的具体执行步骤是本底线在特定上下文中的**落地细化**，不属于重复定义。
> **同步机制**：当 state-machine.md 或 domains/ 变更时，必须检查本表中对应的“同步引用”列是否需要同步更新。
