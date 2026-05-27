---
name: augment
version: "6.5.0"
description: "Ritsu 补测引擎。分析设计契约与覆盖率缺口，智能补全测试用例。"
author: "3kaiu"
license: "MIT"
homepage: "https://github.com/3kaiu/Ritsu"
tags: ["testing", "coverage", "mcp-server", "assertions"]
when_to_use: "/r-augment, 补测试, 提高覆盖率"
total_steps: 4
---

# Augment: 测试充分性引擎

> **⚡️ Prompt Topology** — 三段式不可交叉：`anti-patterns.yaml` + `mcp-tools.yaml`（Stage 1）→ this file（Stage 2）→ `_suffix: true` 数据（Stage 3，末尾）。

**触发条件**：用户输入 `/r-augment`。

## 执行流水线

### -1. Prompt Caching 对齐

> 引用 `_shared/skill-common-steps.md` Step -2。优先构建静态基座（`rules/anti-patterns.yaml` + `_shared/mcp-tools.yaml`）后，再进入后续动态流程。

### 1. 契约与覆盖率对账
- **读取设计单**：查找最近的 `design-sheet`，提取 `verification_plan.contracts`。
- **获取覆盖率**：调用 `ritsu_run_quality_gates` 并解析其返回的 `coverage.per_file` 字段。
- **测试质量分析**：调用 `ritsu_run_quality_gates(analyze_test_quality: true)` 获取 `test_quality` 指标。重点关注：
  - `assertion_density < 2.0`：平均断言密度偏低，需要追加多场景断言
  - `tests_without_assertions > 0`：存在无断言的测试用例，优先补断言
  - `snapshot_only > 0`：存在仅依赖快照的测试，追加明确断言
  - `mock_gap`：存在未 mock 的外部依赖，建议 mock 或集成测试
  - `contract_coverage < 100`：部分契约没有对应测试断言，优先补
- **优先级排序**：按 `test_quality.quality_score` 从低到高排序文件，优先处理低分模块。
- **识别缺口**：对比 Contract 中的 `test_file_hint` 与实际文件的覆盖率。找出没有测试断言或者覆盖率偏低的 Contract。

### 2. 生成测试用例 (Generate)
- 针对未被充分测试的 Contract，编写针对性的测试断言。
- 确保测试代码符合项目的偏好和技术栈测试规范 (Vitest/Jest/etc.)。
- 将新增的测试写入测试文件。

### 3. 质量门禁二次验证 (Verify)
- 再次运行 `ritsu_run_quality_gates`，确认：
  - 测试通过 (`passed: true`)。
  - 覆盖率有实质性提升，填补了先前的缺口。
- 若测试失败，进行一次自助修复 (`hunting` 模式)。

### 4. 产出交付报告 (Deliver)
- 将补测结果（包含新增了哪些 contract 对应的断言、覆盖率变化）写入 `dev-report` 的 `verification_result`。
- `ritsu_emit_event(done)`。

---
## 💡 AI 行为约束
- **HC-Augment**：禁止在补测阶段修改业务核心代码。如果业务代码由于写测试而被发现存在无法被 mock 等架构问题，应提交建议并交由 `/r-dev` 或重构。

## Gotchas

| What happened | Rule |
|---|---|
| 补测时改了业务代码，引入了新 bug | Never modify business logic during test augmentation |
| 测试覆盖率报告 100% 但实际只测了 happy path | Verify edge cases and error paths match the coverage report |
| Mock 了外部依赖但忘记验证 mock 被调用了 | Always assert mock interactions, not just output |
