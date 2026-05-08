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

## 前置检查 (Pre-flight)
- 若 `__RITSU_LOADED__` 已标记，跳过 Context Loader 重复装载。
- 否则执行完整 Context Loader 序列（含领域配置装载）。

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
无论什么领域，命中以下红线之一，直接拒绝合并：

| # | Hard Stop | 对应 Anti-Pattern |
|---|---|---|
| 1 | **不明标识符**：代码中引入了找不到定义的变量或组件 | #2 Hallucinate paths |
| 2 | **版本号不同步**：`package.json` 等多处版本号出现割裂 | (新增，无对应) |
| 3 | **明文凭证泄露**：存在硬编码的 Token、Key、或敏感日志全量打印 | (新增，无对应) |
| 4 | **破坏性契约变更**：修改了现有 API/数据格式但不向后兼容，且无双写/迁移方案 | (新增，无对应) |
| 5 | **数据迁移不可逆**：迁移脚本无法回滚，或没有回滚测试 | (新增，无对应) |
| 6 | **安全漏洞引入**：新增依赖存在已知 CVE，或代码中存在注入/越权风险 | (新增，无对应) |

> **映射关系**：Hard Stops 是 Anti-Patterns 在 review 上下文中的严格超集。#1 对应 #2，其余为 review 专属红线。

### 3. 领域动态对抗审查 (Domain-Adaptive Adversarial Pass)
执行 `domains/_base.md` 中的通用审查攻击向量。
执行 `domains/[domain].md` 中的领域增量审查攻击向量。
对照 `domains/` 中的**纪律-攻击向量对偶映射表**，逐条验证：每条编码纪律是否被对应的攻击向量测试通过。

**跨域攻击检查**（所有领域必做）：
- 后端 API 返回值是否被前端无条件信任并渲染？（后端→前端跨域信任）
- 前端输入校验是否与后端校验对齐？（前端→后端校验断裂）

### 4. 自动化扫描集成 (Automated Scan)
- **Lint**：必须运行 `AGENTS.md` 质量门禁中的 Lint 命令。若标记为"需补充"，发出警告但不阻塞。
- **依赖安全扫描**：运行 `npm audit` / `pip audit` / `cargo audit` 等。若工具不可用，发出警告但不阻塞。
- **SAST**：若项目配置了 SAST 工具，必须运行并纳入审查结果。若未配置，发出建议但不阻塞。
- **失败策略**：扫描失败时，区分"工具缺失"（警告+继续）vs"扫描发现漏洞"（Hard Stop #6，拒绝合并）。

### 5. 打回路由 (Reject Routing)
- 若打回原因为**设计缺陷**（架构漂移、契约偏离），路由到：**`/r-think [修复设计]`**
- 若打回原因为**代码缺陷**（Bug、安全漏洞、标识符错误），路由到：**`/r-dev [修复代码]`**

## 关联流转闭环 (State Machine)
> "❌ 律 (Ritsu) 拦截成功。发现致命漏洞。
> - 设计缺陷请执行：**`/r-think [修复设计中指出的漏洞]`**
> - 代码缺陷请执行：**`/r-dev [修复报告中指出的漏洞]`**"

> "✅ 律 (Ritsu) 对抗审查完毕。未发现结构性漏洞。
> 如需处理新工单，请输入：**`/r-triage`**"
