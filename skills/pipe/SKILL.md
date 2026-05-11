---
name: pipe
version: "3.8.0"
description: "Ritsu 流水线编排引擎。按预设序列自动衔接技能，传递上下文，追踪进度。"
when_to_use: "/r-pipe, 端到端交付, 从头到尾, 一条龙, 全流程"
total_steps: 4
hard_constraints:
  - id: HC-1
    rule: "流水线内技能必须严格按序列执行，禁止跳过或乱序（--skip 除外）"
    severity: FATAL
  - id: HC-2
    rule: "任一技能 failed 时必须暂停，等待用户决定，禁止自动跳过失败技能"
    severity: FATAL
  - id: HC-3
    rule: "熔断触发时必须自动重定向至 think，禁止继续流水线"
    severity: FATAL
---

# Pipe: 流水线编排引擎 (Pipeline Orchestrator)

**触发条件**：用户输入 `/r-pipe {pipeline_name}`，或由 `/r-route` 路由至流水线模式。

## 预设流水线

引用 `_shared/state-machine.yaml` states.pipe.pipelines 定义：

| 流水线名   | 触发场景                 | 技能序列             |
| ---------- | ------------------------ | -------------------- |
| `standard` | 新需求，需设计→开发→审查 | think → dev → review |
| `bugfix`   | Bug 修复                 | hunt → dev → review  |
| `optimize` | 代码优化                 | optimize → review    |
| `test_add` | 补充测试                 | test → review        |

## 执行流水线

### 1. 流水线初始化

> 引用 `_shared/skill-common-steps.md` Step 0 + Step 1

`[Step 1 Complete]` 后确定流水线类型：

- **用户指定**（如 `/r-pipe standard`）→ 直接使用
- **用户未指定** → 根据意图推断：
  - 新需求 → standard
  - 报错/Bug → bugfix
  - 优化/精简 → optimize
  - 补测试 → test_add
- **无法推断** → 询问用户选择

输出流水线计划：

```
🔧 流水线: {pipeline_name}（共 {N} 步）
  Step 1/{N}: /r-{skill_1} — {技能用途}
  Step 2/{N}: /r-{skill_2} — {技能用途}
  ...
  Step {N}/{N}: /r-{skill_N} — {技能用途}

执行模式: {standard|fast（每技能按其 fast_mode 声明）}
```

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=pipe, artifact=null）

### 2. 逐技能执行（HC-1 执行协议）

`[Step 1 Complete]` 后按序列逐个执行技能。

**每个技能的执行协议**：

```
─── 流水线进度: Step {current}/{total} — /r-{skill} ───

1. 执行当前技能的 SKILL.md 定义的全部步骤
2. 技能完成后检查结果：
   ✅ done → 输出技能交付摘要，推进到下一步
   ❌ failed → 暂停流水线（HC-2），向用户展示：
      "⚠️ /r-{skill} 执行失败：{error}
       选择：[H]自愈诊断（自动 /r-hunt + 沙盒最多 3 次尝试→汇报）/ [R]重试当前技能 / [T]熔断升维→/r-think / [A]终止流水线"
   🔥 熔断 → 自动重定向至 /r-think（HC-3），流水线暂停
```

当用户选择 **[H] 自愈诊断** 时：

- 立即停止继续执行后续 steps。
- 调用 `ritsu_env_probe` 输出环境与 worktree 能力概况。
- 执行一次 **历史相似案例召回（长期工程记忆）**（用于快速定位可能的配置/入口/修复策略）：
  - 若 `.ritsu/semantic-index.json` 尚不存在或明显过旧，先调用：
    - `ritsu_semantic_index_build({ chunk_size: 1200, chunk_overlap: 200, max_files: 200 })`
  - 若 `.ritsu/kg.json` 存在（或你已知依赖图对定位关键），优先使用 Vectorized Graph RAG（语义 + KG 相关性重排）：
    - 可选：先调用 `ritsu_build_kg({ max_files: 2000 })`（若 kg 不存在或明显过旧）
    - `focus_paths` 必须尽量自动化获取：
      - 优先调用 `ritsu_get_diff`，从其 `changed_files` 取前 5-10 个（相对项目根）
      - 若 diff 不可用，则调用 `ritsu_get_changed_files` 取 `files` 作为降级
    - `ritsu_semantic_graph_rerank({ query: "{失败摘要/报错信息的 1-2 句概括}", top_k: 5, types: ["diagnosis", "review-stamp"], focus_paths: ["{changed_files[0..N]}"], semantic_weight: 0.7, kg_weight: 0.3, kg_depth: 4 })`
  - 否则回退到纯语义检索：
    - `ritsu_semantic_search({ query: "{失败摘要/报错信息的 1-2 句概括}", top_k: 5, types: ["diagnosis", "review-stamp"] })`
  - 输出命中的历史文件路径 + heading + snippet，并强调其仅为线索，后续必须用当前证据验证
- 自动进入 `/r-hunt`：
  - 必须输出【边界定义】与【MECE 假设列表】
  - 禁止改代码
- 进入沙盒重试循环（最多 3 次）：

  对 attempt = 1..3：
  - 4.1 调用 `ritsu_sandbox_prepare({ correlation_id, base_ref: "HEAD" })`
  - 4.2 在沙盒内执行“最小可复现命令”（可多次调用，但每次必须是单命令）：
    - `ritsu_sandbox_exec({ correlation_id, command: "git status --porcelain" })`
    - `ritsu_sandbox_exec({ correlation_id, command: "{最小复现命令}" })`
  - 4.3 证据采集：记录 attempt 编号、命令、`ok/output/cwd`
  - 4.4 当某个 step 失败时，必须做出选择并显式执行其一：
    - `ritsu_sandbox_cleanup({ correlation_id })`

  **提前停止条件**（命中任一即停止剩余 attempt）：
  - 在沙盒中 **稳定可复现**（同一命令输出明确失败）
  - 或确认 **不可复现且证据一致**（例如沙盒连续 2 次通过，但本地/CI 失败，且 env_probe 显示环境差异）

4. 强制汇报（输出格式固定，不得省略）：

   ```
   ## 🧪 自愈诊断汇报（Pipe/H）
   - correlation_id: {cid}
   - 触发失败技能: /r-{skill}
   - 沙盒可用性: ✅/❌（来自 ritsu_env_probe）
   - 沙盒是否可复现: ✅/❌/不确定
   - 最小复现命令: {command}
   - attempt 记录:
     - #1: ok={true|false}, 摘要={一行}, 关键证据={片段}
     - #2: ...
     - #3: ...
   - 最可能根因: {一句话}
   - 下一步建议: [R]重试当前技能 / [T]熔断→think / [A]终止
   ```

**上下文传递规则**：

- 自动传递 `correlation_id` 和 `domain`，无需重新解析
- 上游技能的产物文件自动作为下游技能的输入：
  - think → handoff-\*.md → dev 自动绑定
  - hunt → diagnosis-\*.md → dev 自动绑定
  - dev → 代码变更 → review 自动抓取 diff
  - optimize → 代码变更 → review 自动抓取 diff
  - test → 测试文件 → review 自动抓取 diff
- 每个技能完成后输出精简摘要（1-3 行），不重复输出完整交付清单

**fast 模式下的技能执行**：

- `/r-pipe --fast`：流水线中每个技能按其 `fast_mode` 声明执行
- 无 `fast_mode` 声明的技能按 standard 执行
- fast 模式下技能间不输出详细步骤，仅输出关键结果

### 3. 流水线控制指令

用户可在流水线执行过程中随时发出控制指令：

| 指令                 | 效果                           |
| -------------------- | ------------------------------ |
| `/r-pipe --skip`     | 跳过当前技能，推进到下一步     |
| `/r-pipe --abort`    | 终止流水线，输出已完成步骤摘要 |
| `/r-pipe --fast`     | 切换后续技能为 fast 模式       |
| `/r-pipe --standard` | 切换后续技能为 standard 模式   |

> 控制指令通过自然语言识别，用户无需精确输入指令格式。如"跳过这步"、"停"、"加速"均可识别。

### 4. 流水线完成与交付总览

`[所有技能执行完成]` 后输出交付总览：

```markdown
## 🔧 流水线交付总览: {pipeline_name}

| Step  | 技能         | 状态  | 关键产出     |
| ----- | ------------ | ----- | ------------ |
| 1/{N} | /r-{skill_1} | ✅/❌ | {产物或摘要} |
| 2/{N} | /r-{skill_2} | ✅/❌ | {产物或摘要} |
| ...   | ...          | ...   | ...          |

- 总耗时技能: {N}
- 成功: {M} | 失败: {K} | 跳过: {L}
- 产物文件: {列出 .ritsu/ 下新增的所有产物}
- 溯源链路: correlation_id={cid}
```

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=pipe, artifact=null）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=pipe）
