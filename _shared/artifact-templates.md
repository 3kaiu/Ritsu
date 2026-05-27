# 主产物模板 v8.0.0

> 所有设计与契约信息统一为”设计单 (Design Sheet)”。

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
- 验证计划:
  - 测试命令: {如何验证功能正确，包含测试命令或手动 Checklist}
  - 契约验证 (Contracts):
    | ID | 契约描述 | 测试断言位置 |
    | --- | --- | --- |
    | C1 | {描述改动必须满足的业务契约} | `{测试文件路径或提示}` |

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

## 4. 契约对账 (Contract Verdicts)

适用条件: dev 阶段有设计单且包含 contracts。

根据质量门禁中的 `contract_verification` 数据逐条填写：

| Contract ID | 描述 | 状态 | 证据 |
| --- | --- | --- | --- |
| C1 | {契约描述} | {passed\|failed\|partial} | {测试文件:行号 或 说明} |
| C2 | {契约描述} | {passed\|failed\|partial} | {测试文件:行号 或 说明} |

> 状态说明: passed = 测试文件存在且包含契约引用; partial = 测试文件存在但无明确契约引用; failed = 未找到对应测试或断言。

## 5. 失败回流 (Rejection Feedback)
- 拒绝原因: {若 PASS 则写”无”}
- 强制修复清单:
  - [ ] {具体的代码位置或逻辑点}: {修复要求}

## 6. 后续建议
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
- 质量门禁对账 (Quality Gates):
  - 总状态: {passed|failed|partially_skipped}
  - Lint: {passed|failed|skipped}
  - Test: {passed|failed|skipped}
  - 覆盖率 (Lines): {87.5%|n/a}

## 变更明细
- 主要产出: {代码/测试/文档}
- 关联设计单: {design-sheet 路径}

---
## Deploy Plan (部署计划)

适用产物类型：`deploy-plan`
适用等级：Standard (P1) / Critical (P2)

```markdown
# Deploy Plan (部署计划)

## 1. 部署概览 (Overview)
- 变更摘要: {一句话描述本次部署的内容}
- 部署模式: {quick|standard|canary|full_rollout}
- 风险评估: {low|medium|high}

## 2. 回滚计划 (Rollback)
- 回滚步骤:
  1. {git revert / 配置回滚 / 数据回滚 的具体命令}
  2. {缓存清理或服务重启命令}
  3. {验证回滚后状态的方法}
- 数据回滚: {若有数据库变更，需包含回滚 SQL 脚本或迁移命令}
- 回滚验证方式: {如何确认回滚成功}

## 3. 部署策略 (Strategy)
- 发布策略: {全量 / 灰度 / 金丝雀}
- 灰度比例: {10% -> 50% -> 100%，仅灰度模式}
- 灰度观察时长: {30min / 1h / 24h，仅灰度模式}
- 健康检查方式: {接口 / 进程 / 依赖服务}

## 4. 监控与告警 (Monitoring)
- 关注指标: {错误率 / 延迟 p50/p95/p99 / CPU / 内存}
- 告警阈值: {错误率 > X%, p95 > Y ms}
- 观察窗口: {15min / 1h / 24h}

## 5. 上线后验证 (Post-Deploy)
- 冒烟验证:
  1. {curl 命令或 UI 操作步骤}
  2. {预期输出或结果}
- 性能基线: {关键路径的预期延迟基线}

## 6. 决策记录 (Decision Log)
- 审批门禁: {谁确认了本次部署，基于什么}
- 应急预案: {部署失败时的替代方案}
```

---

## Deploy Report (上线报告)

适用产物类型：`deploy-report`
适用等级：Micro (P0) 快速上线

```markdown
# Deploy Report (上线报告)

## 发布结果
- 结果: {success|partial|failed|rolled_back}
- 发布时间: {时间戳}
- 耗时: {时长}

## 验证结果
- 冒烟测试结论: {通过/失败}
- 健康检查结论: {通过/失败}
- 异常记录: {若有异常，记录详情}
```

---

## Coordination Sheet (协调单)

适用产物类型：`coordination-sheet`
适用场景：Multi-Agent 协作、任务拆分、复杂跨模块并行。

```markdown
# Coordination Sheet (协调单)

## 1. Intent & Trace
- Original Goal: {原始总任务描述}
- Trace ID: {trace-XXXX-XXXX} (根 Trace)

## 2. Child Spans (子工单声明)
| Span ID | Agent Role | Sub-task Description | Priority |
| --- | --- | --- | --- |
| {span-XXXX} | {frontend|backend|...} | {子任务内容} | {P0|P1|P2} |

## 3. Handoff Matrix (交接矩阵)
- Dependencies: {子任务间的依赖关系，如 Span A 必须在 Span B 之前完成}
- Shared Context: {需要共享的变量、配置、或临时文件路径}

## 4. Constraint Propagation (约束透传)
- Key Preferences: {从总任务透传给子任务的项目偏好}
- Design Boundaries: {总任务划定的技术边界}

---
## 🚀 下一步建议
{建议分发给对应的 Agent 执行，并在子任务结束后通过 /r-join-trace 汇总}
```
