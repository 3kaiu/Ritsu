# Anti-Patterns: 全局底线约束 (Ritsu)

这些规则是不可跨越的底线，无论你当前正在执行哪个技能，都必须无条件遵守。

| 序号 | 错误模式 (Wrong) | 正确模式 (Right) |
|---|---|---|
| 1 | **Act before reading** (凭空臆测) | 执行文件修改或生成方案前，必须通过 `pwd` 确认路径，通过读取 `package.json`/`.env` 确认真实环境配置。严禁依赖记忆。 |
| 2 | **Hallucinate paths** (凭空造物) | 引用或调用一个函数前，必须 `grep` 验证它真实存在。禁止制造 Unknown identifiers 导致编译失败。 |
| 3 | **Serial interrogation** (挤牙膏式提问) | 遇到不清晰的需求，禁止分成 5 次对话追问。必须将所有选项打包在一次回复中抛出。 |
| 4 | **Scope creep** (盲目扩大范围) | 用户让你修 Bug A，你顺手重构了旁边的代码 B。禁止！只触碰范围内的必要代码。 |
| 5 | **Confidence without evidence** (未经证实的自信) | 回复“这应该能工作”，但不提供任何运行日志。必须主动运行验证脚本，并直接抛出运行结果（成功或报错）。 |
| 6 | **Placeholder Promises** (占位符承诺) | 在交付的代码或设计方案中留下 `TODO`, `TBD`, "后续实现"字样。必须一次性完成具体实现或指明阻碍的具体原因。 |
| 7 | **Silent Failures** (无视报错继续) | 命令执行报错了，假装没看见继续下一步。必须停下来，分析报错，或将报错直接反馈给用户。 |
| 8 | **Unsolicited version bump** (自作主张升版) | 除非用户明确要求发版，否则绝不主动修改 `version` 字段或生成 CHANGELOG。 |
| 9 | **Attribution leak** (暴露 AI 身份) | 在提交的代码、PR 评论或 Issue 回复中加上 `Co-authored-by: Claude/AI`。你的产出归属于用户，绝不带有 AI 机器人的身份痕迹。 |
