---
name: dev
version: "6.1.0"
description: "Ritsu 开发实现入口。根据任务等级自动选择最优执行路径。"
when_to_use: "/r-dev, 写代码, 开发, 修复 bug, 开始实现, 改一下, 调整"
total_steps: 5
---

# Dev: 自适应代码实现与交付

**触发条件**：用户输入 `/r-dev`，或自动路由判定为开发任务。

## 执行流水线

### 0. 分级判定

> 引用 `_shared/skill-common-steps.md` Step 0

判定完成后，按等级分叉：

---

### 🟢 Micro 路径 (P0)

**准入条件**: 变更 < 20 LoC，单文件，无逻辑架构变动。

1. **直接编码**: 根据用户描述直接修改代码。遵循 HC-1 (引用安全) 和 HC-2 (零占位符)。
2. **质量验证**: 运行 lint 或 type check。
3. **一句话回复**: "已完成。修改了 `{文件}` 的 {N} 行。" — 结束，无产物，无 ctx。

---

### 🟡 Standard 路径 (P1)

**准入条件**: 常规需求，多文件联动，有 design-brief 或 design-sheet。

1. **目标对账**: 读取 `design-brief` 或 `design-sheet`，确认实施清单。
2. **技术栈感知**: 识别项目指纹，加载对应领域纪律。
3. **偏好加载**: 若 `.ritsu/preferences.yaml` 存在，读取并遵循项目偏好（如：优先使用 ahooks、组件拆分粒度等）。
4. **编码实现**: 服从设计文档并执行领域纪律 (HC-1/HC-2/HC-3)。
5. **质量门禁**: 运行 `ritsu_run_quality_gates`。若当前任务已持有 `correlation_id` / `trace_id` / `span_id`，必须原样传入，使 snapshot 与当前执行轨迹绑定；同时会记录当时的 Git 工作树指纹。未通过则禁止交付。
6. **交付摘要**: 必须将 quality_gates 的结果写入 `dev-report` 的 `质量门禁对账 (Quality Gates)` 结构化字段中（至少包含 `总状态` / `Lint` / `Test`，若有覆盖率则附 `覆盖率 (Lines)`），并在 `write_artifact` / `emit_event(done)` 时继续沿用同一组 `correlation_id` / `trace_id` / `span_id`；若质量门禁后又发生代码变更，必须重新运行 `ritsu_run_quality_gates`，否则禁止交付。

---

### 🔴 Critical 路径 (P2)

**准入条件**: 架构变更、基础组件修改、跨模块重构。

1. **完整对账**: `ritsu_read_ctx` + 关联 `design-sheet` + 若存在 `coordination-sheet`，读取分配的 `trace_id` 和 `parent_span_id`。调用 `ritsu_open_span`。
2. **技术栈感知**: 识别项目指纹，自动切换资深专家人格。
3. **偏好加载**: 读取 `.ritsu/preferences.yaml`。
4. **高保真实现**: 严格服从 `design-sheet`，代码风格与领域 YAML 100% 对齐。
5. **质量门禁**: 运行 `ritsu_run_quality_gates`，并传入当前 `trace_id` / `span_id`。未通过则禁止 `emit_event(done)`。
6. **产物交付**: 产出完整 `dev-report`（必须包含结构化 quality_gates 结果） + `emit_event(done)` + 交付摘要。`run_quality_gates`、`write_artifact(dev-report)`、`emit_event(done)` 必须属于同一条 trace/span，且工作树必须与质量门禁通过时一致；若最近一次 quality gate 非 `passed`、trace/span 不一致，或门禁后工作树再度变化，禁止 `emit_event(done)`。
7. **强制引导**: "代码已实现。建议运行 `/r-review` 进行最终验收。"
