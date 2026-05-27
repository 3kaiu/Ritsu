---
name: deploy
version: "8.1.0"
description: "Ritsu 部署门禁入口。产出《部署计划 (Deploy Plan)》，确保可回滚、可灰度、可观测。"
author: "3kaiu"
license: "MIT"
homepage: "https://github.com/3kaiu/Ritsu"
tags: ["deploy", "release", "rollback", "canary", "mcp-server"]
when_to_use: "/r-deploy, deploy, 部署, 发布, 上线, release, 推到生产"
total_steps: 5
---

# Deploy: 自适应部署门禁

> **⚡️ Prompt Topology** — 三段式不可交叉：`rules/anti-patterns.yaml` + `_shared/mcp-tools.yaml`（Stage 1）→ this file（Stage 2）→ `_suffix: true` 数据（Stage 3，末尾）。

**触发条件**：用户输入 `/r-deploy`，或 review 阶段 assurance-sheet 的 deployability 为 `deployable` 时建议下一步。

## 执行流水线

### -1. Prompt Caching 对齐

> 引用 `_shared/skill-common-steps.md` Step -2。优先构建静态基座（`rules/anti-patterns.yaml` + `_shared/mcp-tools.yaml`）后，再进入后续动态流程。

### 0. 分级判定

> 引用 `_shared/skill-common-steps.md` Step 0

| 级别 | 特征 | 产出 |
|------|------|------|
| 🟢 P0 | 纯配置变更 / 非功能性修复 / 文档 | 快速上线建议，无需 deploy-plan |
| 🟡 P1 | 标准功能变更、有 assurance-sheet | deploy-plan（含回滚计划） |
| 🔴 P2 | 涉及数据迁移 / 依赖变更 / 多服务部署 / 用户可见变更 | deploy-plan + 灰度策略 + 监控方案 |

---

### 🟢 Micro 路径 (P0)

1. 确认无数据迁移、无依赖变更、无用户可见行为变化。
2. 输出「快速上线」建议。
3. 产出 `deploy-report`（可选），无需 `deploy-plan`。

---

### 🟡 Standard / 🔴 Critical 路径

#### 1. Preflight（必须）

`ritsu_preflight(stage: deploy)` — 读 ctx、assurance-sheet、artifacts。

Preflight 重点关注：
- 是否有最新的 `assurance-sheet`，且 verdict.deployability 为 `deployable`
- 变更涉及的文件列表与类型（前端/后端/数据迁移）
- 是否存在已确认的 `rollback_steps`（来自 design-sheet 的 Metrics & Risks 章节）
- 是否存在 feature flag 控制

若 assurance-sheet 不存在或 deployability 非 `deployable`，提示先运行 `/r-review`。

#### 2. 部署前检查清单

依据分级逐项验证：

```
必检项（P1/P2）：
  □ 回滚计划：能否 git revert / 数据库回滚 / 配置回滚
  □ 健康检查：是否有明确的上线后健康检查方式
  □ 依赖检查：新引入的依赖是否已有 CVE 扫描（可选 ritsu_exec npm audit）
  □ feature flag：如果存在 flag，确认默认关闭且可灰度开关

P2 附加项：
  □ 数据库迁移：是否可向前兼容、有回退脚本
  □ 灰度策略：比例、持续时间、退出条件
  □ 兼容性：API 版本 / 数据格式向后兼容
  □ 监控关注点：错误率、latency、资源使用基线
```

与 assurance-sheet 对账：检查 review 阶段已发现的 risk 是否有对应的 deploy 缓解措施。

#### 3. 部署策略建议

根据风险评估和变更类型输出策略建议：

| 变更类型 | 推荐策略 |
|---------|---------|
| 纯前端构建 | CI → CDN → 全量发布（灰度可选） |
| 后端 API 变更 | 金丝雀发布（10% → 50% → 100%） |
| 数据库迁移 | migrate → canary → validation → scale |
| 基础架构变更 | 灰度集群、异地灾备演练 |
| 依赖/运行时升级 | 先 staging 验证 24h，再全量 |

P2 场景需明确灰度比例、验证窗口、metric 阈值、回滚触发条件。

#### 4. 上线后验证

输出上线后的验证清单：

- **Smoke test 建议**：针对改动的核心路径给出 3-5 条 curl / UI 验证命令
- **性能基准**：涉及性能改动的场景给出延迟 p50/p95/p99 的预期基线
- **错误率基线**：改动前错误率 vs 预期上限
- **观察窗口**：建议的监控观察时长（如 15min / 1h / 24h）
- **回滚触发条件**：错误率上升 X%、p95 延迟超过 Y ms、错误率超过 Z%

#### 5. 产出与归档

- **P1**: 产出 `deploy-plan`（标准部署计划）
- **P2**: 产出 `deploy-plan`（含灰度策略、监控方案、回滚触发条件）
- **P0 可选**: 产出 `deploy-report`（简要上线说明）
- 可选 `ritsu_emit_event(status: deploy_plan_written)` 记录事件
- `ritsu_span_lifecycle action=close` 关闭当前 span

## 上下游引用

- 上游：`assurance-sheet`（review 阶段产出）
- 下游：无需后续 Skill，但可建议用户验证上线后运行 `/r-hunt` 排查问题

## Gotchas

| What happened | Rule |
|---|---|
| 部署后发现数据迁移不可回滚 | 检查所有 DDL/DML 是否可逆，必要时要求按阶段迁移 |
| 灰度比例过高触发报警 | 灰度起步不超过 5%，观察窗口不少于监控系统最小采样周期 |
| 健康检查通过但业务错误率飙升 | 区分存活检查与就绪检查，增加业务语义的健康端点 |
| 没有 feature flag 就上线了高危变更 | 在上线前确认 flag 系统就绪，默认关闭 |
| 回滚计划只是 "git revert" | API 变更和数据迁移后单纯 revert 代码通常不够 |

## 参考

- `_shared/artifact-schema.yaml` → `deploy_plan` 产物格式
- `_shared/artifact-templates.md` → deploy-plan / deploy-report 模板
- `ROADMAP.md` → Deploy Gate 为 v8.1 新增路线
