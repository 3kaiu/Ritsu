# 主产物模板 v5.2.0

> 为了减少信息碎片，自 v5.0 起，所有设计与契约信息统一合并为“设计单 (Design Sheet)”。
> Handoff 已被废弃，其核心的技术契约、风险评估与实施清单已并入此模板。

---

## Design Sheet (设计单)

适用产物类型：`design-sheet`

```markdown
# Design Sheet (设计单)

## 1. 任务识别 (Intake)
- 任务类型: {新功能/Bug/补测试/重构/优化/纯阅读/扩展任务}
- 当前目标: {一句话描述}
- 风险等级: {quick|standard|critical}

## 2. 方案与边界 (Plan)
- 交付目标: {详细描述要求完成的状态}
- 纳入范围: {本次明确要完成的内容}
- 不纳入范围: {本次明确不做的内容}
- 依赖与前置条件: {若无则写“无”}

## 3. 技术契约 (Contract)
- 核心改动文件: {列表}
- 关键接口/组件变动: 
  {若是后端：API Path, Request/Response Schema}
  {若是前端：Component Props, Emits, State Machine}
  {若是重构：逻辑等价性说明}

## 4. 决策理由 (Decision Rationale)
- 关键决策: {选型及其核心优势}
- 被拒绝方案: {方案名}: {拒绝理由}

## 5. 代价与风险 (Metrics & Risks)
- 复杂度评分: {1-10}
- 架构侵入度: {1-10}
- 回滚步骤: {上线发现致命 Bug 的确切回滚指令} (Optional)

## 6. 实施清单 (Execution)
- 实施步骤:
  - [ ] `{文件路径}`: {精准的修改逻辑，确保 dev 阶段无需做技术决策}
- 验证计划: {如何验证功能正确，包含测试命令或手动 Checklist}

---
## 🚀 下一步建议
{根据分析结果，建议运行 /r-dev 开始实现}
```

---
## Design Brief (设计简报)

适用产物类型：`design-brief`
适用等级：Standard (P1)

> 相比完整 Design Sheet，Design Brief 移除了"代价与风险"章节，
> 将"技术契约"简化为"关键改动点"，信息量缩减 60%。

```markdown
# Design Brief

## 目标
{一句话描述交付目标}

## 关键改动
- `{文件路径}`: {改动内容}

## 实施清单
- [ ] {步骤 1}
- [ ] {步骤 2}

## 验证
- {验证方式}
```

---

## Assurance Sheet (验收单)

适用产物类型：`assurance-sheet`

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
- 业务影响: {一句话总结对业务的影响}

## 4. 失败回流 (Rejection Feedback)
- 拒绝原因: {若 PASS 则写“无”}
- 强制修复清单:
  - [ ] {具体的代码位置或逻辑点}: {修复要求}

## 5. 后续建议
- 建议下一步: {进入发布流程|回到 dev 修复|回到 think 重设方案}
```

---

## Dev Report (开发回执)

适用产物类型：`dev-report`

```markdown
# Dev Report

## 交付摘要
- 实施结果: {完成/部分完成/失败}
- 验证结果: {通过/部分通过/失败}

## 变更明细
- 主要产出: {代码/测试/文档}
- 关联设计单: {design-sheet 路径}

---
## 🚀 下一步建议
{建议运行 /r-review 进行最终验收}
```
