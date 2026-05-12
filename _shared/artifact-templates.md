# 主产物模板 v3.8.0

> 这些模板是 `intake-ticket / delivery-plan / delivery-report / assurance-report / release-advice` 的单一参考源。
> `route / pipe / review` 只能引用，不应各自维护一份近似版本。
> 若 `_shared/artifact-schema.yaml` 调整了章节名或字段标签，必须先同步这里。
> 默认消费顺序也是这一组主链路产物；`handoff / diagnosis / optimize-report / review-stamp` 仅用于补充说明，不替代这里的结论。

---

## Intake Ticket

适用产物类型：`intake-ticket`

```markdown
# Intake Ticket

## 任务识别
- 任务类型: {新功能/Bug/补测试/重构/优化/纯阅读/扩展任务}
- 当前目标: {一句话描述}

## 风险与信息
- 风险等级: {quick|standard|critical}
- 信息完备度: {充分/部分缺失/严重缺失}
- 缺失信息: {若无则写“无”}

## 执行路径
- 推荐路径: {deliver.quick|deliver.standard|deliver.critical|assure|extension}
- 次要意图: {若无则写“无”}
```

---

## Delivery Plan

适用产物类型：`delivery-plan`

```markdown
# Delivery Plan

## 目标与范围
- 交付目标: {一句话描述}
- 纳入范围: {本次明确要完成的内容}
- 不纳入范围: {本次明确不做的内容}

## 实施计划
- 实施步骤: {按顺序列出关键步骤}
- 依赖与前置条件: {若无则写“无”}

## 验证与回滚
- 验证计划: {如何验证完成}
- 回滚说明: {若无则写“无”}
```

---

## Delivery Report

适用产物类型：`delivery-report`

```markdown
# Delivery Report

## 交付摘要
- 模式: {quick|standard|critical}
- 任务目标: {一句话}
- 实施结果: {完成/部分完成/失败}
- 验证结果: {通过/部分通过/失败}

## 变更与风险
- 主要产出: {代码/测试/文档/诊断}
- 已知风险: {若无则写“无”}
- 下一步: {进入 assure / 回到 deliver / 回到设计}
```

---

## Assurance Report

适用产物类型：`assurance-report`

```markdown
# Assurance Report

## 验收结论
- 合并结论: {mergeable|not_mergeable}
- 上线结论: {deployable|not_deployable|deployable_with_risk}

## 阻断项与风险
- 阻断项: {若无则写“无”}
- 剩余风险: {若无则写“无”}

## 建议动作
- 建议下一步: {进入 deploy / 回到 deliver / 回到 think}
```

---

## Release Advice

适用产物类型：`release-advice`

```markdown
# Release Advice

## 发布建议
- 合并建议: {建议合并/建议暂缓合并}
- 上线建议: {建议上线/建议暂缓上线/建议灰度上线}
- 灰度/放量建议: {若无则写“无”}

## 风险与回滚
- 发布风险: {若无则写“无”}
- 回滚条件: {若无则写“无”}

## 业务影响摘要
- 业务影响: {对用户、运营、客服或业务指标的影响}
- 协作说明: {需要通知的角色或后续协作动作；若无则写“无”}
```
