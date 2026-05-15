# Skill 公共步骤模板 v5.2.0

> 所有 `SKILL.md` 中重复出现的步骤，统一引用此模板。
> 目标：提供自适应的分级交付路径，平衡效率与治理。

---

## Step -1: 意图识别与自动路由 (Intent Routing)

当用户未使用 `/r-` 指令时，根据以下规则自动分发：

| 用户意图 | 路由目标 | 触发等级 |
|---|---|---|
| 修改代码 / 改颜色 / 改文案 / 修 bug | → `dev` | Micro |
| 实现新功能 / 重构 / 优化 | → `think` | Standard |
| 架构迁移 / 底层组件变更 | → `think` | Critical |
| 报错 / 排障 / 为什么不工作 | → `hunt` | Standard |
| 解释代码 / 这是什么 / 分析 | → `freestyle` | — |
| 快速问答 | → `freestyle` | — |

**注意**: 自动路由只是建议，AI 应在回复开头简短说明路由决策。

---

## Step 0: 分级判定与路径分发 (Tier Routing)

在执行实质性动作前，**先判定任务等级，再决定走哪条路径**。

### 0.1 任务等级自动判定

根据以下信号自动判定，无需用户手动指定：

| 信号 | Micro (P0) | Standard (P1) | Critical (P2) |
|---|---|---|---|
| 用户描述复杂度 | 单句、单文件、样式/文案调整 | 功能增改、多文件联动 | 架构变更、重构、性能优化 |
| 预估变更行数 | < 20 LoC | 20-500 LoC | > 500 LoC 或跨多模块 |
| 关键词 | "改一下"、"换成" | "实现"、"优化" | "架构"、"底层"、"迁移" |

### 0.2 分级路径

- **Micro (P0)**: 跳过 Step 0.3/Step 1/Step 2，直接执行核心操作 → 运行质量门禁 → 输出一句话结论。**无产物、无 ctx 事件。**
- **Standard (P1)**: 执行轻量对账，使用 `design-brief` 替代 `design-sheet`。ctx 事件仅记录 `done`。
- **Critical (P2)**: 完整流程。强制 `ritsu_read_ctx` 对账，产出完整 `design-sheet`，强制 `contract-validate`。

### 0.3 现场对账 (仅 Standard/Critical)

调用 `ritsu_read_ctx`（Critical 必选，Standard 可选）：
- **模式选择**：默认使用 `detail: false` 以节省 Token。仅在 `circuit_breaker_status` 异常或需要追溯 10 条以上历史时开启 `detail: true`。
- **断点识别**：查看 `breakpoint_summary` 和 `recommended_next_step`。
- **产物关联**：自动加载最近的 `design-sheet` 或 `dev-report`。

---

## Step 1: 领域解析与 Started 标记 (仅 Standard/Critical)

按以下优先级解析领域，输出 `[RITSU_CTX: domain={value}]`：
1. 读取 `AGENTS.md` 的 `domain`。
2. 调用 `ritsu_get_changed_files`。

对于 **Critical (P2)** 任务，调用 `ritsu_open_span` 开启追踪，获取 `trace_id` 和 `span_id`。如果用户提供了 `trace_id`，则需作为 `parent_span_id` 传入以关联上下文。

---

## Step 2: 产物落盘与事件追加

### 2.1 产物写入
调用 `ritsu_write_artifact` 写入主产物。
- Standard: `design-brief` / `dev-report`
- Critical: `design-sheet` / `dev-report` / `assurance-sheet`

### 2.2 事件与 Span 追踪
对于 Standard/Critical，在阶段结束时调用 `ritsu_close_span`（如果已开启 Span）或追加 `done` 事件。

---

## Step 3: 强制流转引导

所有技能完成时，必须给出明确的“下一步”建议。

---

## Step 4: 统一交付摘要

输出标准化摘要，减少用户的阅读成本。

```markdown
## 律 (Ritsu) {skill_name} 交付摘要
- 关键结论: {一句话描述核心产出}
- 下一步建议: {明确的指令建议}
```
---

## Step 5: 产物编写范式 (Few-Shot Prompting)

为了确保产物质量，请参考以下 `design-sheet` 优秀范例：

**示例 1: 复杂重构 (Critical)**
> ## 1. 任务识别 (Intake)
> - 任务类型: 重构 (Refactoring)
> - 当前目标: 将 Monolithic `AuthService` 拆分为 `OAuthManager` 与 `SessionStore`
> - 风险等级: Critical
> ## 2. 方案与边界 (Plan)
> - 交付目标: 消除 `AuthService` 的循环依赖，实现 100% 单元测试覆盖
> - 纳入范围: `src/services/auth/*`
> - 不纳入范围: 外部 OAuth 提供商回调逻辑
> ## 4. 决策理由 (Decision Rationale)
> - 关键决策: 采用 Repository Pattern 隔离数据库操作，便于 Mock 测试。
> - 被拒绝方案: 依赖注入库 (InversifyJS): 增加 Bundle Size，不符合项目 Lean 原则。
> ## 6. 实施清单 (Execution)
> - 实施步骤:
>   - [ ] `src/services/auth/oauth-manager.ts`: 新建 OAuth 处理类
>   - [ ] `src/services/auth/session-store.ts`: 迁移 Redis 存储逻辑

**示例 2: 简单功能 (Standard)**
> ## 目标
> - 交付目标: 在导航栏增加 "关于我们" 链接
> ## 关键改动
> - 修改 `Navbar.tsx` 增加 Link 组件
> - 路由配置 `routes.ts` 增加 `/about`
