# 律 (Ritsu) v5.0.0

Ritsu 是一套工业级、面向工程交付的 AI 协作标准。它通过**显式阶段 (Explicit Staging)** 与**动态上下文对账 (Context Sync)**，将 AI 的生产力锁定在确定性的交付轨道上。

## 核心理念：确定性 > 自动化

在工业级交付中，AI 的“全自动黑盒编排”往往意味着不可控。Ritsu 选择了另一条道路：

1.  **阶段显式 (Explicit Staging)**：任务被严格拆分为 `think` (分析), `dev` (开发), `test` (测试), `hunt` (诊断), `review` (验收)。每一阶段都有明确的准入标准和产物契约。
2.  **分级交付 (Tiered Delivery)**：针对不同风险的任务自动适配流程：
    - **Micro (P0)**: 修改 < 10 LoC。秒级响应，跳过设计单，直接交付。
    - **Standard (P1)**: 常规需求。强制产出 `design-sheet`，确保方案经过 AI 内部博弈。
    - **Critical (P2)**: 架构级变更。强制执行契约校验 (`contract-validate`) 与多维红蓝对抗 Review。
3.  **产物收敛 (Artifact Consolidation)**：废弃碎片化的文档，所有技术决策收敛于 `design-sheet`，交付结论收敛于 `assurance-sheet`。
4.  **智能流转 (Context Auto-Sync)**：通过事件流实时计算“任务断点”，实现“断点续传”式的开发体验，无需人为干预上下文对账。

---

## 快速开始

### 1. 安装与初始化

```bash
npx skills add 3kaiu/Ritsu -a claude-code -g -y
/r-init
```

### 2. 标准交付指令

| 指令 | 适用场景 | 核心产物 |
| --- | --- | --- |
| `/r-think` | 需求审核、技术方案设计、技术契约确认 | **`design-sheet.md`** |
| `/r-dev` | 代码实现、Bug 修复、快速路径执行 | **`dev-report.md`** |
| `/r-review` | 最终交付验收、发布风险评估、反馈回流 | **`assurance-sheet.md`** |
| `/r-test` | 质量门禁校验、补齐单元测试 | 验证摘要 |
| `/r-hunt` | 根因诊断、技术取证、修复建议 | 诊断报告 |

---

## 核心机制：失败回流 (Rejection Feedback)

如果 `/r-review` 判定失败，AI 会在 `assurance-sheet` 中生成结构化的**修正补丁**。当你再次运行 `/r-dev` 时，系统会自动对账该补丁，确保之前发现的问题被强制修复，杜绝无效重试。

---

## 仓库结构

```text
Ritsu/
├── skills/     # 显式阶段入口 (think/dev/test/hunt/review)
├── runtime/    # MCP 工具执行层 (事件流驱动，无 Flow 依赖)
├── _shared/    # 统一协议 (Schema v5.0、产物模板、分级规范)
├── rules/      # 全局工程红线 (anti-patterns.yaml)
└── domains/    # 领域适配规则 (frontend/backend/fullstack/infra)
```

Ritsu 的目标是让 AI 的动作**可观测、可对账、可信任**。