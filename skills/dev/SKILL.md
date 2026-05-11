---
name: dev
version: "3.8.0"
description: "Ritsu 领域自适应编码管道。防闭眼修改、未定义标识符拦截，按领域强制落地开发纪律。"
when_to_use: "/r-dev, 写代码, 开发, 修复 bug"
total_steps: 7
fast_mode:
  skip_steps: [2, 5, 7]
  skip_artifacts: true
  self_test: "ritsu_run_quality_gates"
  description: "跳过领域纪律深度检查(2)、沙盒自查(5)、Handoff自愈(7)，直接编码+质量门禁自测，不写产物文件"
hotfix_mode:
  description: "微变更快速通道：跳过全部前置检查和Handoff溯源，直接修改+质量门禁自测。仅适用于≤1文件/≤10行的确定性微变更（typo/配置值/单行CSS等）"
  rules:
    - "变更必须≤1文件且≤10行，超出则拒绝执行hotfix，降级为fast或standard"
    - "必须明确知道改什么、改哪里、改后的预期效果，禁止探索性修改"
    - "不读取Handoff、不执行领域纪律、不写产物文件、不做沙盒自查"
    - "仍须调用 ritsu_run_quality_gates 确认不破坏现有功能"
hard_constraints:
  - id: HC-1
    rule: "ref AP-2: 引用或调用外部标识符前必须 grep 验证其真实存在，并确保调用签名对齐"
    severity: FATAL
  - id: HC-2
    rule: "ref AP-6: 交付物不得包含占位符"
    severity: FATAL
  - id: HC-3
    rule: "不得修改 Handoff 实施清单范围之外的内容"
    severity: WARN
  - id: HC-4
    rule: "当实施清单超过 3 项时，严禁一次性全量输出代码。必须强制分块（每次≤2项），并在块间执行验证与用户确认"
    severity: FATAL
---

# Dev: 领域严苛的纯净编码 (Adaptive Implementation)

**触发条件**：用户输入 `/r-dev`。

> ⚡ **fast 模式**：`/r-dev --fast` 或变更 ≤3 文件/≤30 行时自动触发。跳过步骤 2/5/7，不写产物文件，仅执行步骤 1→3→4→6 + 精简交付摘要。

> 🔥 **hotfix 模式**：`/r-dev --hotfix` 微变更快速通道。跳过全部前置（Handoff/领域纪律/沙盒自查/契约自愈），直接修改 + quality_gates 自测。仅限 ≤1 文件/≤10 行的确定性微变更（typo/配置值/单行CSS等）。

## 执行流水线

### 0. hotfix 模式检查

若用户指定 `--hotfix`，检查变更规模：

- **≤1 文件且 ≤10 行** → 执行 hotfix：跳过步骤 1-5 和 7，直接进入步骤 6 质量门禁（步骤 3/4 简化为直接修改），完成后输出精简交付摘要
- **超出限制** → 告知用户"hotfix 仅限 ≤1 文件/≤10 行的确定性微变更，当前变更已超出，降级为 /r-dev --fast 或 /r-dev"

hotfix 交付摘要格式：

```
## 🔥 Hotfix 落盘
- 文件: {路径}
- 变更: {一行描述}
- Lint: ✅/❌ | Test: ✅/❌
```

### 1. 领域解析与零点击寻址 (Zero-Click Context Binding)

> 引用 `_shared/skill-common-steps.md` Step 1

`[Step 1 Complete]` 后进入步骤 2。

读取项目级规则覆盖（Domain Adaptive 强化）：

- 调用 `ritsu_read_agents` 获取 `rules_overrides.add`
- 过滤 `scope=dev` 的规则（如 `PROJ-FE-ZUSTAND-*`）
- 将其视为本次 dev 的额外硬约束：
  - 与领域 `coding_disciplines` 同级执行
  - 命中时必须停止并要求修正

**隐式绑定优先**：首先检查当前 IDE（Cursor/Windsurf）是否已激活打开了任何 `handoff-*.md` 或 `diagnosis-*.md` 文件。

- **若有** → 直接将其认定为本次 `dev` 的执行目标，跳过询问！并在输出中注明"已根据 IDE 焦点自动锁定目标文件"。

若未发现 IDE 焦点文件，则调用 **`ritsu_list_artifacts`**（type=handoff）：

- **单个文件** → 读取，严格按实施清单执行
- **多个文件** → 列出文件名+修改时间，默认最新，告知用户可指定其他
- **用户已指定文件** → 直接读取指定文件
- **无文件** → 继续执行，在交付摘要注明"无 Handoff 溯源（风险已知悉）"

### 2. 领域专属编码纪律

按当前领域已加载的 `coding_disciplines` 执行（`domains/_base.yaml` + `domains/{domain}.yaml`）。对每条 discipline 的 `rule` 字段严格遵守，违反即停止编码。

### 3. 标识符验证（ref AP-2 执行协议）

`[Step 2 Complete]` 后进入步骤 3。

调用任何外部模块的函数/变量/组件前，**按以下协议执行（签名级校验）**：

**TS/JS 项目优先（编译上下文校验，工程友好）**：

若项目存在 `tsconfig.json`（或用户明确为 TS/JS 项目），在进行逐个标识符 grep 前，先调用一次：

```
调用 ritsu_ts_check({ tsconfig_path: "tsconfig.json", max_diagnostics: 20, timeout_ms: 60000 })
```

- `passed=true` → 继续执行下方的逐标识符校验
- `passed=false` → 立即停止编码，输出 diagnostics 前若干条，并进入自愈诊断协议（失败 → 自动 hunt → 沙盒最多 3 次尝试 → 汇报）

在 TS/JS 项目中，逐标识符校验时优先使用“类型系统查询”而不是纯文本 grep：

```
0. 调用 ritsu_ts_symbol_query({ symbol: "{标识符}", tsconfig_path: "tsconfig.json", file_hint: "{可选: 目标文件}", max_definitions: 10, max_references: 10 })
   - 若 definitions_count>0：
     - 必须读取 signature/type 字段（若存在）并据此校验自己的调用参数结构
     - 若存在多定义/多重载且无法判定，应缩小 file_hint 或询问用户，禁止盲猜
   - 若 definitions_count=0：回退到下方 grep 路径（用于兜底或非 TS 文件场景）
```

```
1. 调用 ritsu_exec({command: `grep -rnC 3 --max-count=10 "{标识符}" . --include="*{后缀}" --exclude-dir={node_modules,.git,dist}`})
2. ✅ exists=true  → 必须阅读返回的 context 字段：
   - 提取该标识符的【函数签名/参数定义/类型说明】
   - 检查自己的调用代码是否与该签名严格对齐（参数顺序、对象结构、必填项）
   - 若签名与预期不符，严禁盲目猜测，必须修正自己的调用逻辑或询问用户
3. ❌ exists=false → 停止编写该调用，输出错误提示并等待指示
```

> 💡 `ritsu_get_diff` 的 `new_identifiers` 字段已自动提取 diff 中新增的标识符，review 时可直接使用，无需逐个 grep。

### 4. 降维分块执行与测试先行 (Chunked Execution)

`[Step 3 Complete]` 后进入步骤 4。

分析需要实现的任务清单总数：

- **若清单项 ≤ 3**：可全量执行，但在编写业务逻辑前，先写出验证手段（单测用例、curl 或 UI 验证步骤）。
- **若清单项 > 3**（触发 HC-4 强制约束）：
  1. **截断**：仅选取前 1-2 项核心逻辑执行。
  2. **验证**：调用 `ritsu_run_quality_gates` 执行 Lint + Test。
  3. **断点确认**：向用户展示当前批次结果，询问"继续下一批次 / 暂停审查 / 回滚当前批次"，等待用户回复。严禁一次性输出所有代码导致幻觉翻车。

### 5. 沙盒自查清单（按优先级）

`[Step 4 Complete]` 后进入步骤 5。

- [ ] AP-2：所有外部标识符均已通过 `ritsu_exec` (grep) 验证 — 违反时输出错误提示并停止
- [ ] HC-2：代码中无 TODO / 待定 / 后续完善 / 暂不处理 — 违反时输出错误提示并停止
- [ ] 无孤儿引用，无未使用的残余变量

### 6. 质量门禁

`[Step 5 Complete]` 后进入步骤 6。

在执行 Lint/Test 之前，必须进行契约测试（Contract Validation）：

- 调用 `ritsu_contract_validate({min_coverage: 0.8})`
- 若 `passed=false`：
  - 输出 coverage_ratio 与 missing 列表
  - 禁止进入质量门禁，必须补齐实现或回到 `/r-think` 调整契约

调用 **`ritsu_run_quality_gates`** 执行 Lint + Test，等待结果：

- passed: true → 可以交付
- passed: false → 查看 test.failures 定位失败用例，修复后重新执行，不允许带着失败交付

当质量门禁连续失败或出现“无法稳定复现/环境不一致/疑似缓存污染”时，触发 **自愈诊断协议（失败 → 自动 hunt → 沙盒最多 3 次尝试 → 汇报）**：

1. 调用 `ritsu_env_probe` 输出环境与 worktree 能力概况（用于判断是否具备沙盒条件）
2. 执行一次 **历史相似案例召回（长期工程记忆）**（用于快速定位可能的配置/入口/修复策略）：
   - 每次进入“历史相似案例召回”都先调用一次增量构建（工具会按 content_hash 复用旧条目，成本可控）：
     - `ritsu_semantic_index_build({ chunk_size: 1200, chunk_overlap: 200, max_files: 200 })`
   - 若 `.ritsu/kg.json` 存在（或你已知依赖图对定位关键），优先使用 Vectorized Graph RAG（语义 + KG 相关性重排）：
     - 可选：先调用 `ritsu_build_kg({ max_files: 2000 })`（若 kg 不存在或明显过旧）
     - `focus_paths` 必须尽量自动化获取：
       - 优先调用 `ritsu_get_diff`，从其 `changed_files` 取前 5-10 个（相对项目根）
       - 若 diff 不可用，则调用 `ritsu_get_changed_files` 取 `files` 作为降级
     - `ritsu_semantic_graph_rerank({ query: "{质量门禁失败摘要/报错信息的 1-2 句概括}", top_k: 5, types: ["diagnosis", "review-stamp"], focus_paths: ["{changed_files[0..N]}"], semantic_weight: 0.7, kg_weight: 0.3, kg_depth: 4 })`
   - 否则回退到纯语义检索：
     - `ritsu_semantic_search({ query: "{质量门禁失败摘要/报错信息的 1-2 句概括}", top_k: 5, types: ["diagnosis", "review-stamp"] })`
   - 输出命中的历史文件路径 + heading + snippet，并强调其仅为线索，后续必须用当前证据验证
3. 进入 `/r-hunt`（在同一会话内自动切换思维模式，不改代码），并提供以下结构化上下文：
   - quality_gates 的失败输出（lint/test output + failures 列表）
   - 本次变更的 diff 摘要（优先调用 `ritsu_get_diff`）
   - 当前执行目标 handoff（若存在）
4. 沙盒最多 3 次尝试（同一个 `correlation_id`）：
   - 调用 `ritsu_sandbox_prepare({ correlation_id, base_ref: "HEAD" })`
   - 针对失败项做“最小可复现命令”执行：
     - lint 失败：`ritsu_sandbox_exec({ correlation_id, command: "npm run lint" })`（或项目实际 lint 命令）
     - test 失败：`ritsu_sandbox_exec({ correlation_id, command: "npm test" })`（或项目实际 test 命令）
   - 若需要多命令链路，必须拆成多次 `ritsu_sandbox_exec`（禁止管道/重定向）
   - 每次尝试结束都必须调用 `ritsu_sandbox_cleanup({ correlation_id })`，确保不残留 worktree
5. 输出汇报（强制）：
   - “在沙盒中是否可复现”
   - “复现的最小命令”
   - “证据指向的最可能根因”
   - “下一步建议”：继续 /r-hunt 深挖，或返回 /r-dev 继续修复

### 7. Handoff 契约自愈 (Handoff Drift Prevention)

`[Step 6 Complete]` 后进入步骤 7。

必须防止代码与设计文档发生割裂。

- 对比最终落盘的代码与步骤 1 溯源到的 `handoff-*.md` 文件。
- 如果在 Bug 修复或需求变更过程中，**实际代码的逻辑、接口结构、或架构层级推翻了原 Handoff 的契约**：
  - 必须主动调用 `ritsu_write_artifact` 修改原 `handoff-*.md` 文件对应位置的契约内容，确保文档与代码保持一致。

**交付摘要**（强制输出）：

> 引用 `_shared/skill-common-steps.md` Step 4（skill=dev）

写入 ctx（started + done 事件）：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=dev, artifact=null）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=dev）
