---
name: review
version: "3.8.0"
description: "Ritsu 最终验收入口。基于代码、验证结果和风险状态，给出是否可合并、可上线的结论。"
when_to_use: "/r-review, review, code review, 审查代码, 看看有没有漏洞"
total_steps: 5
fast_mode:
  skip_steps: [4]
  skip_artifacts: false
  self_test: null
  description: "跳过领域语义深审，优先产出快速验收结论，仍写 assurance-report（必要时附兼容镜像）"
hard_constraints:
  - id: HC-1
    rule: "阻断项命中后必须给出不可合并/不可上线结论，禁止继续包装成可接受风险"
    severity: FATAL
  - id: HC-2
    rule: "无论 PASS/FAIL，必须写入验收结论产物"
    severity: FATAL
  - id: HC-3
    rule: "变更获取必须同时使用工作区和暂存区两个命令"
    severity: FATAL
  - id: HC-4
    rule: "验收结论必须同时覆盖阻断项、剩余风险和建议动作，禁止只给模糊结论"
    severity: FATAL
---

# Review: Assure 最终验收入口 (Final Assurance Gate)

**触发条件**：用户输入 `/r-review`。

> 当前文件名仍为 `review`，但产品语义上承担 `assure`。

> ⚡ **fast 模式**：`/r-review --fast` 或变更 ≤3 文件/≤30 行时自动触发。优先产出快速验收结论，再决定是否需要深审。

## 执行流水线

### 1. 领域解析

> 引用 `_shared/skill-common-steps.md` Step 1

### 2. 交付证据收集

`[Step 1 Complete]` 后进入步骤 2。

调用 **`ritsu_get_diff`** 获取结构化变更分析。

同时收集本次交付的核心证据：

- 变更内容
- intake-ticket / handoff / diagnosis（若存在）
- 质量门禁结果
- 契约覆盖情况
- 是否存在高风险变更

调用 `ritsu_read_agents` 获取项目级规则覆盖：

- 若存在 `rules_overrides.add` 且 `scope=review`，将其视为额外阻断项

调用 **`ritsu_list_artifacts`**（优先 `type=handoff`，必要时回退检查 `type=intake-ticket`）：

- 若存在 handoff，逐条核对契约和实施清单
- 若仅存在 intake-ticket，明确标注“仅有 intake 溯源，缺少细化实施契约”
- 若均不存在，明确标注“无契约溯源”

调用 **`ritsu_run_quality_gates`** 执行 Lint + Test，记录结果。

调用 `ritsu_contract_validate({min_coverage: 0.8})`：

- `passed=true` → 继续
- `passed=false` → 记为高风险或阻断项，视情况要求回补实现或回到设计
- 若 `artifact_type=intake-ticket`，应额外说明该覆盖率仅代表粗粒度契约，不等同 handoff 级实施清单覆盖

### 3. 阻断项检查

`[Step 2 Complete]` 后进入步骤 3。

按优先级检查 `_shared/anti-patterns.yaml` review 红线 R-1~R-6。

一旦命中阻断项，必须立即给出：

- 不可合并 / 不可上线
- 阻断原因
- 建议回退路径

若未命中阻断项，则继续进入风险与建议评估。

### 4. 风险与建议评估

`[Step 3 Complete]` 后进入步骤 4。

按当前领域已加载的 `attack_vectors` 逐条审查。

同时必须额外输出：

- 至少 **3 条潜在风险**（触发条件 + 影响 + 如何验证）
- 至少 **2 条改进建议**（不要求本次立即处理）

### 5. 写入验收结论

`[Step 4 Complete]` 后进入步骤 5。

优先调用 **`ritsu_write_artifact`**（type=`assurance-report`）写入主验收产物：

- md 路径：`.ritsu/assurance-report-{YYYYMMDD-HHMMSS}.md`

内容至少覆盖：

- 验收结论
- 阻断项与风险
- 建议动作

如当前下游仍依赖 legacy 产物，可附加写入一份精简 **`review-stamp`** 作为兼容镜像；但产品语义上，`assurance-report` 才是主验收结论。

按 `_shared/artifact-schema.yaml` 对应 Schema 写入，同时在会话末尾内联输出。

**验收结论必须显式包含**：

- 合并结论：`mergeable / not_mergeable`
- 上线结论：`deployable / not_deployable / deployable_with_risk`
- 阻断项
- 剩余风险
- 建议下一步

若本次结果为 FAIL，或检测到熔断将重定向至 `/r-think`，则主验收产物需追加：

```markdown
## 熔断反馈（给 /r-think）

- 失败摘要: {一句话}
- 命中规则: {规则列表}
- 需要升维确认的问题:
  - {问题1}
  - {问题2}
- 推荐的重设边界/契约调整:
  - {建议1}
```

**交付摘要**：

> 引用 `_shared/skill-common-steps.md` Step 4（skill=review）

**⚠️ 熔断检测 (Circuit Breaker)**：

- 若连续失败达到阈值，禁止继续在原路径上来回重试
- 必须引导回 `/r-think` 或要求人工介入

写入 ctx-{YYYY-MM}.jsonl：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=review, artifact=.ritsu/assurance-report-{ts}.md）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=review）
