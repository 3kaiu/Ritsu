# 主产物模板 v4.0.0

> 为了减少信息碎片，自 v4.0 起，所有阶段产物合并为“设计单 (Design Sheet)”与“验收单 (Assurance Sheet)”。
> 这种合并不仅减少了文件数量，也确保了从需求到实现的逻辑连贯性。

---

## Design Sheet (设计单)

适用产物类型：`design-sheet`
整合了原有的 `think-ticket`, `think-plan` 以及技术契约 (Handoff)。

```markdown
# Design Sheet (设计单)

## 1. 任务识别 (Intake)
- 任务类型: {新功能/Bug/补测试/重构/优化/纯阅读/扩展任务}
- 当前目标: {一句话描述}
- 风险等级: {quick|standard|critical}

## 2. 方案与边界 (Plan)
- 交付目标: {详细描述}
- 纳入范围: {本次明确要完成的内容}
- 不纳入范围: {本次明确不做的内容}
- 依赖与前置条件: {若无则写“无”}

## 3. 技术契约 (Contract)
- 核心改动文件: {列表}
- 关键接口/组件变动: {契约定义，若无则写“无”}

## 4. 实施与验证 (Execution)
- 实施清单: 
  - [ ] {文件路径}: {动作}
- 验证计划: {如何验证完成}
- 回滚说明: {若无则写“无”}

---
## 🚀 下一步建议
{根据分析结果，建议运行 /r-dev 或其它指令}
```

---

## Assurance Sheet (验收单)

适用产物类型：`assurance-sheet`
整合了原有的 `review-report` 与 `review-advice`。

```markdown
# Assurance Sheet (验收单)

## 1. 验收结论 (Verdict)
- 合并结论: {mergeable|not_mergeable}
- 上线结论: {deployable|not_deployable|deployable_with_risk}

## 2. 风险与阻断 (Risks)
- 阻断项: {若无则写“无”}
- 剩余风险: {若无则写“无”}

## 3. 发布与协作 (Advice)
- 上线建议: {建议上线/建议暂缓上线/建议灰度上线}
- 灰度/放量建议: {若无则写“无”}
- 业务影响: {一句话总结对业务的影响}

## 4. 后续建议
- 建议下一步: {进入 deploy|回到 dev|回到 think}
```

---

## Dev Report

适用产物类型：`dev-report`（保持独立，作为开发交付回执）

```markdown
# Dev Report

## 交付摘要
- 模式: {quick|standard|critical}
- 实施结果: {完成/部分完成/失败}
- 验证结果: {通过/部分通过/失败}

## 变更明细
- 主要产出: {代码/测试/文档/诊断}
- 已知风险: {若无则写“无”}
- 关联设计单: {design-sheet 路径}

---
## 🚀 下一步建议
{建议运行 /r-test 或 /r-review}
```
