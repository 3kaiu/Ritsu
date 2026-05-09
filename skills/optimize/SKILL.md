---
name: optimize
version: "3.5.1"
description: "Ritsu 领域自适应代码精简优化。不改功能/布局/结构/样式，只做精简、性能提升和平台适配优化。"
when_to_use: "/r-opt, 优化, 精简, 性能优化, refactor, 代码瘦身, 提速"
token_budget: 6000
total_steps: 5
required_sections:
  [optimize_disciplines, optimize_tool_preferences, platform_optimizations]
hard_constraints:
  - id: HC-1
    rule: "优化前后功能必须完全等价——任何行为变更视为违规，必须回滚"
    severity: FATAL
  - id: HC-2
    rule: "禁止新增功能、样式、布局、结构——只做减法和等价替换"
    severity: FATAL
  - id: HC-3
    rule: "每项优化必须可独立验证——合并多项不可测的微优化等于未优化"
    severity: FATAL
  - id: HC-4
    rule: "外部标识符替换前必须调用 ritsu_exec 执行 grep 验证新标识符存在且签名对齐"
    severity: FATAL
---

# Optimize: 领域自适应代码精简优化

> 核心原则：**只做减法和等价替换，绝不做加法。**

---

## 不可变边界 (Immutable Boundaries)

以下内容**绝对禁止变更**，违反任何一条即终止优化：

1. **功能行为**：输入输出、副作用、错误处理路径必须完全一致
2. **布局与结构**：DOM 层级、组件树、路由结构不变
3. **视觉样式**：用户可见的任何像素不变（CSS 等价替换允许，如 `margin: 0 auto` → `mx-auto`）
4. **公共接口**：export 的函数签名、Props 类型、API 契约不变
5. **数据流**：状态管理路径、数据流向不变

---

## 执行流水线

### 1. 领域解析

> 引用 `_shared/skill-common-steps.md` Step 1

### 2. 深度分析 (Deep Analysis)

`[Step 1 Complete]` 后进入步骤 2。

对目标文件及其直接依赖进行**只读扫描**，产出分析清单：

| #   | 类别       | 当前写法                         | 替换为                    | 预期收益  | 风险 |
| --- | ---------- | -------------------------------- | ------------------------- | --------- | ---- |
| 1   | 死代码     | {未使用的变量/函数/导入/类型}    | 删除                      | 体积↓     | 低   |
| 2   | 冗余逻辑   | {可合并条件/重复计算/可内联函数} | 合并/内联                 | 可读性↑   | 低   |
| 3   | 算法热点   | {O(n²)→O(n) 机会/不必要全量遍历} | 优化算法                  | 性能↑     | 中   |
| 4   | 工具库替换 | {手写逻辑}                       | {领域推荐工具函数}        | 可维护性↑ | 中   |
| 5   | 语义化标签 | {div/span}                       | {header/main/section/nav} | 可访问性↑ | 低   |
| 6   | 注释清理   | {无用注释}                       | 删除/保留 TSDoc           | 体积↓     | 低   |
| 7   | 样式精简   | {内联/冗余 CSS}                  | {TailwindCSS 等价类}      | 体积↓     | 低   |
| 8   | 平台优化   | {WebView 专属问题}               | {领域推荐平台优化}        | 性能↑     | 中   |
| 9   | 请求优化   | {接口请求模式}                   | {领域推荐请求工具}        | 性能↑     | 中   |

> ⚠️ 分析阶段**禁止修改任何文件**。只产出清单，等待用户确认。

### 3. 优化方案确认

`[Step 2 Complete]` 后进入步骤 3。

将步骤 2 的分析清单补充实际值后呈现给用户确认。

**风险评级规则**：

- **低**：删除死代码、等价 CSS 替换、注释清理
- **中**：工具库替换、算法优化、语义标签替换
- **高**：涉及状态管理路径、异步逻辑重构

> 向用户展示清单并询问："确认执行哪些优化项？（全选 / 指定编号 / 跳过高风险项）"
> 收到确认前，保持等待。

### 4. 逐项执行 (Item-by-Item Execution)

`[Step 3 Complete]` 后进入步骤 4（收到用户确认后）。

按确认清单**逐项**执行，每项执行后立即验证：

**执行纪律**：

- **单次单项**：每次只改一个优化项，禁止批量合并修改 — 违反时追加 `ritsu_emit_event(event_type=step_failed, violation={id:AP-8, severity:FATAL, pattern:"Scope creep", evidence:"单次修改多个优化项"})`
- **立即验证**：每项改完后立即运行质量门禁（Lint + Test）
- **失败即停**：若 Lint/Test 失败，立即回滚该项，调用 `ritsu_emit_event(event_type=approval_required, approval={type:confirm, title:"优化项回滚确认", options:["确认回滚并继续下一项", "终止优化"]})`，记录到优化报告
- **标识符校验**：替换工具函数/组件时，必须先 `ritsu_exec` (grep) 验证新标识符存在且签名对齐 — 违反时追加 `ritsu_emit_event(event_type=step_failed, violation={id:AP-2, severity:FATAL, pattern:"Hallucinate paths", evidence:"新标识符未在代码库中找到"})`

**领域专属优化规则**（按 domain 动态加载）：

> 引用 `domains/{domain}.yaml` 的 `optimize_disciplines` 和 `optimize_tool_preferences` 和 `platform_optimizations`

### 5. 优化报告输出

`[Step 4 Complete]` 后进入步骤 5。

所有优化项执行完毕后，输出精简报告：

```markdown
# 优化报告: {文件/模块名}

_优化 by /r-opt · domain: {value} · date: {YYYY-MM-DD}_

## 执行摘要

- 总优化项: {N}
- 成功: {M} | 跳过(风险): {K} | 失败回滚: {L}

## 成功项明细

| #   | 优化项 | Before → After | 验证              |
| --- | ------ | -------------- | ----------------- |
| 1   | ...    | ...            | ✅ Lint+Test 通过 |

## 跳过/回滚项

| #   | 优化项 | 原因                 |
| --- | ------ | -------------------- |
| ... | ...    | Test 失败 / 用户跳过 |

## 质量门禁

- Lint: {✅/❌}
- Test: {✅/❌}
```

写入 ctx-{YYYY-MM}.jsonl：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=optimize, artifact=.ritsu/optimize-report-{ts}.md）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=optimize）
