# Ritsu MCP Server Runtime

> Runtime: `3.5.1` · Protocol: `v3.8.0`

`runtime/` 是 Ritsu 的工具执行层，不负责定义新的用户入口。

当前默认工作流已经切到显式 skill：

- `think`
- `dev`
- `test`
- `hunt`
- `review`

runtime 的职责是为这套白盒工作流提供稳定工具，而不是再把用户包进黑盒编排里。

现在 runtime 还额外提供一层轻量的 flow runtime：

- `Flow Registry`：从 `_shared/flows/*.yaml` 加载交付流程模板
- `Flow Runner`：按 precheck -> steps -> verifications 执行，并在 `.ritsu/flows/*.json` 写恢复状态
- `Execution Adapters`：把 `read_ctx / read_agents / get_diff / quality_gates` 之类的稳定动作接成可复用 flow step

主链路的最小闭环是：

1. `ritsu_run_flow` 创建 flow run，并在 `ai_decision` 步骤停下
2. AI 根据当前判断位产出结论
3. `ritsu_apply_flow_decision` 提交 decision payload，必要时同时写主产物
4. runtime 自动继续推进，直到下一个 `ai_decision`、失败或完成

flow state 中会保存 `correlation_id`，用于和 ctx 事件流对账。
若某个 `ai_decision` step 在 manifest 中声明了 `decision_contract`，runtime 会在 `ritsu_apply_flow_decision` 时校验 `decision_output` 的必填字段，以及必须附带的 artifact 类型。
`decision_contract` 还支持对 artifact 内容做最小语义校验，例如要求某种 artifact 至少包含若干 `required_contains` 标记。
当这些 contract 校验失败时，`ritsu_apply_flow_decision` 会返回 `isError=true`，并在响应文本中提供结构化 JSON：`error.type / error.message / error.violations[]`。
`error.violations[]` 现在会尽量一次性收集同一轮提交里可观察到的全部 contract 问题，而不是在第一条失败时立即停止。
`error.violations[]` 也会按稳定顺序返回，当前排序规则是 `severity -> step_id -> path -> code`。
对于 artifact schema 校验，同一份 artifact 内的多个缺 section / 缺 field label 问题也会被一起收集返回。
`error.violations[].path` 现在会区分不同层级，例如：

- `decision_output`
- `artifacts.think-ticket.content.markers.<marker>`
- `artifacts.think-ticket.artifact.sections.<section>`
- `artifacts.think-ticket.artifact.sections.<section>.fields.<label>`

`error.violations[].actual` 也会尽量返回当前观测值：

- 对 `missing_decision_keys`，表示已收到的 decision 顶层 keys
- 对 `artifact_content_missing_markers`，表示 artifact 中同标签的实际内容行
- 对 `artifact_schema_missing_section`，表示 artifact 中当前已有的 section 标题
- 对 `artifact_schema_missing_field_label`，表示该 section 中当前检测到的字段标签

`error.violations[].severity` 当前固定为 `error`，用于给上层保留稳定的优先级字段。

直接调用 `ritsu_write_artifact` 时，如果命中 artifact schema 校验失败，也会返回结构化 JSON：
`error.type / error.message / error.violations[]`。这组 `violations[]` 与 flow decision 中的 artifact schema violation 字段语义保持一致，只是不包含 `step_id`，且 `path` 直接从 `artifact.sections...` 开始。
对于常见写入拒绝（缺必填字段、placeholder、非法 type、文件名前缀不匹配、路径穿越、文件已存在），`ritsu_write_artifact` 现在同样返回结构化 JSON，`error.type` 为 `ArtifactWriteError`。
底层原子写入失败（例如 rename/write 阶段的 IO 异常）现在也会返回同一类 `ArtifactWriteError`。

---

## 快速开始

```bash
cd runtime
npm install
npm run build
npm start
```

---

## Runtime 角色

runtime 主要负责四类能力：

1. **状态与产物**
   - ctx 读写
   - artifact 落盘
   - artifact 列表和检索
   - flow state 读写与恢复

2. **工作区证据**
   - changed files
   - diff
   - command exec

3. **交付验证**
   - quality gates
   - contract validate
   - read agents

4. **增强能力**
   - sandbox
   - semantic search / graph rerank
   - KG
   - TS symbol / type checking

---

## 工具分层

### Core Stable

- `ritsu_emit_event`
- `ritsu_read_ctx`
- `ritsu_read_agents`
- `ritsu_list_flows`
- `ritsu_validate_flow`
- `ritsu_run_flow`
- `ritsu_resume_flow`
- `ritsu_get_flow_state`
- `ritsu_apply_flow_decision`
- `ritsu_write_artifact`
- `ritsu_list_artifacts`
- `ritsu_exec`
- `ritsu_get_changed_files`
- `ritsu_get_diff`
- `ritsu_run_quality_gates`

### Advanced Plugin

- `ritsu_contract_validate`
- `ritsu_build_kg`
- `ritsu_query_kg`
- `ritsu_env_probe`
- `ritsu_sandbox_prepare`
- `ritsu_sandbox_exec`
- `ritsu_sandbox_cleanup`
- `ritsu_ts_check`
- `ritsu_ts_symbol_query`
- `ritsu_semantic_index_build`
- `ritsu_semantic_search`
- `ritsu_semantic_graph_rerank`

### Experimental Track

- `runtime/core` 中的 Rust/WASM 加速路径

---

## 当前语义

用户看到的主工作流是：

```text
think -> dev -> test / hunt -> review
```

底层持久化产物推荐使用显式别名，旧名兼容：

- `think-ticket`（兼容旧名 `intake-ticket`）
- `think-plan`（兼容旧名 `delivery-plan`）
- `dev-report`（兼容旧名 `delivery-report`）
- `review-report`（兼容旧名 `assurance-report`）
- `review-advice`（兼容旧名 `release-advice`）

这两层不要混淆：

- **工作流语义**：你当前在做什么
- **产物语义**：系统把过程怎样落盘

---

## Legacy 兼容

runtime 仍可能读取到旧 ctx 记录里的 alias：

- `route` -> 旧版 `think`
- `pipe` -> 旧版编排入口，读取时按接近的开发阶段理解

CLI 会把它们标成 legacy alias，避免误导成当前推荐入口。

---

## 架构

```text
runtime/src/
├── index.ts            # MCP Server 入口
├── schema-compiler.ts  # mcp-tools.yaml -> JSON Schema
├── event-validator.ts  # ctx-event-schema.json 校验
├── ctx-reader.ts       # ctx 读取
├── ctx-writer.ts       # ctx 写入
└── handlers/           # 工具 handler 注册与实现
```

---

## 产物原则

- `primary` 产物优先
- `evidence` 产物补充解释
- `compatibility` 产物只为迁移期或旧调用方保留

更多解释见：

- [_shared/artifact-layers.md](/Users/edy/CascadeProjects/Ritsu/_shared/artifact-layers.md:1)
