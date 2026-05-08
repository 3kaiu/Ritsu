---
name: review
description: "Ritsu 领域自适应代码审查防线。引入 Hard Stops 绝对红线拦截，按领域动态调整黑客攻击向量，确保代码对齐 Handoff 设计案。"
when_to_use: "/r-review, review, code review, 审查代码, 看看有没有漏洞"
metadata:
  version: "3.0.0"
---

# Review: 领域自适应对抗审查 (Adaptive Adversarial Check)

**触发条件**：用户输入 `/r-review`。

## 核心职责 (Capability Convergence)

站在"拒绝合并"的对立面来审查代码。不仅查 Bug，更要执行 **溯源对账**：确保代码完美还原了 `/r-think` 的 Handoff 设计。

## 执行流水线

### 1. 抓取上下文与溯源对账 (Handoff Traceability)

- **变更抓取策略**：
  - 优先：`git diff ritsu-reviewed..HEAD`（基于上次 review 的 git tag）
  - 回退：`git diff HEAD`（仅看最后一次提交）
- **强制对账**：如果存在 `HANDOFF.md`，必须先逐条对比：
  - 契约是否完整实现？
  - 验收标准是否全部达成？
  - 回滚指令是否已落地为可执行脚本或文档？
- **拦截红线**：若代码偏离了原定接口契约、漏掉了 PRD 上的状态展示、或擅自改变了架构层级，视为 **架构漂移 (Handoff Drift)**，直接打回。

### 2. Hard Stops (绝对红线拦截)

执行 `rules/anti-patterns.md` 中 **scope: review** 的全部红线（R1-R6），命中任一条即拒绝合并。同时检查 **scope: global** 的全部底线（#1-#12），全局底线在 review 中同样不可违反。

### 3. 领域动态对抗审查 (Domain-Adaptive Adversarial Pass)

执行 `domains/_base.md` 中的通用审查攻击向量。
执行 `domains/[domain].md` 中的领域增量审查攻击向量。
对照 `domains/` 中的**纪律-攻击向量对偶映射表**，逐条验证：每条编码纪律是否被对应的攻击向量测试通过。

> 跨域攻击检查已内化于领域配置（如 `fullstack.md` 的契约漂移与端到端安全向量），无需在此重复。

### 4. 自动化扫描集成 (Automated Scan)

- **Lint**：必须运行 `AGENTS.md` 质量门禁中的 Lint 命令。若标记为"需补充"，发出警告但不阻塞。
- **依赖安全扫描**：运行 `npm audit` / `pip audit` / `cargo audit` 等。若工具不可用，发出警告但不阻塞。
- **SAST**：若项目配置了 SAST 工具，必须运行并纳入审查结果。若未配置，发出建议但不阻塞。
- **失败策略**：扫描失败时，区分"工具缺失"（警告+继续）vs"扫描发现漏洞"（Hard Stop #6，拒绝合并）。

### 5. 打回路由 (Reject Routing)

- 若打回原因为**设计缺陷**（架构漂移、契约偏离），路由到：**`/r-think [修复设计]`**
- 若打回原因为**代码缺陷**（Bug、安全漏洞、标识符错误），路由到：**`/r-dev [修复代码]`**

> 技能流转参见 `state-machine.md`。
