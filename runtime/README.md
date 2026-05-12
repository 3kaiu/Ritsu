# Ritsu MCP Server Runtime

> Runtime: `3.5.1` · Protocol: `v3.8.0`

`runtime/` 是 Ritsu 的工具执行层，不负责定义产品入口。  
产品面已经收敛为 `intake / deliver / assure`，而 runtime 的职责是提供这些阶段会调用到的稳定工具和增强工具。

从 runtime 视角，所有能力都应被明确归入以下三类之一：

1. `Core Stable`：主链路默认依赖，必须优先保证稳定性
2. `Advanced Plugin`：可选增强，默认不承诺总能带来收益
3. `Experimental Track`：探索性能力，不进入默认交付承诺

当前状态需要明确区分两层：

1. **产品语义**：`intake / deliver / assure`
2. **运行时现实**：主链路产物 `intake-ticket / delivery-plan / delivery-report / assurance-report / release-advice` 已接入核心读写、列表与检索路径；legacy 产物 `handoff / diagnosis / review-stamp / optimize-report` 仍保留为过程证据或兼容镜像

这意味着：

- README 和 skill 文档已经按新模型收敛
- runtime 已完成主链路对齐，但增强能力仍不应被包装成默认承诺

---

## 快速开始

```bash
cd runtime
npm install
npm run build
npm start
```

CLI 辅助查看 ctx 时，`ritsu cat` 会保留底层兼容 `skill` 值，并在适用时附带产品阶段映射：

- `route -> intake`
- `pipe -> deliver`
- `review -> assure`

同时会在输出头部打印一行 `skill mapping`，避免只看单条事件时误把兼容 `skill` 值当成产品阶段名。

---

## IDE 集成

### Cursor

在 `.cursorrules` 或项目 MCP 配置中添加：

```json
{
  "mcpServers": {
    "ritsu": {
      "command": "node",
      "args": ["/path/to/ritsu/runtime/dist/index.js"],
      "env": {
        "RITSU_PROJECT_ROOT": "/path/to/your/project"
      }
    }
  }
}
```

### Windsurf

在 `.windsurfrules` 或 MCP 配置中添加相同配置。

### Claude Desktop

在 `claude_desktop_config.json` 中添加相同结构。

---

## Runtime 角色

runtime 主要负责四类能力：

1. **状态与产物**
   - ctx 读写
   - artifact 落盘
   - artifact 列表和检索

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

这些工具属于主链路默认依赖：

- `ritsu_emit_event`
- `ritsu_read_ctx`
- `ritsu_read_agents`
- `ritsu_write_artifact`
- `ritsu_list_artifacts`
- `ritsu_exec`
- `ritsu_get_changed_files`
- `ritsu_get_diff`
- `ritsu_run_quality_gates`

说明：

- `ritsu_exec` 当前仍在 `Core Stable`，但它的定位应保持克制：主要作为受控工作区证据工具，而不是泛化执行引擎
- 未来若其使用边界继续扩大，应重新评估是否降级为插件能力

### Advanced Plugin

这些工具保留，但默认作为可选增强项消费：

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

说明：

- `ritsu_contract_validate` 虽然和主链路强相关，但当前仍是启发式“实施契约覆盖率”工具，应被视作辅助信号，而不是最终事实来源
- semantic / KG / TS / sandbox / env 系列工具当前都应按“best-effort plugin”理解

### Experimental Track

这些能力已经存在方向或实现雏形，但当前不应被当作默认运行时承诺：

- `runtime/core` 中的 Rust/WASM 加速路径

说明：

- 只有当 Rust/WASM 真实接入事件校验、ctx 索引或 correlation 热路径后，它才能从 `Experimental Track` 升级
- 在接入之前，不应把它写成 runtime 的默认能力

---

## 架构

```text
runtime/src/
├── index.ts            # MCP Server 入口（stdio transport）
├── schema-compiler.ts  # mcp-tools.yaml → JSON Schema 编译器
├── event-validator.ts  # ctx-event-schema.json + ajv 校验
├── ctx-reader.ts       # ctx 读取
├── ctx-writer.ts       # ctx 写入
└── handlers/           # 工具 handler 注册与实现
```

> `handlers/index.ts` 当前注册的 handler 数量已经明显多于早期文档中的“8/9 个工具”。  
> 文档应以实际注册表为准，而不是历史数字。

---

## Legacy 产物现实

虽然产品语义已经转向 `intake / deliver / assure`，runtime 仍会接触 legacy 产物与过程证据：

- `handoff-*`
- `diagnosis-*`
- `review-stamp-*`
- `optimize-report-*`
- `ctx-*`

但主链路产物已经进入稳定运行时能力：

- `ritsu_write_artifact` 返回标准化 `artifact_meta`
- `ritsu_emit_event` 会为 `artifact_written` 自动补 `artifact_meta.layer`
- `ritsu_list_artifacts` 返回 `artifact_type + artifact_layer`
- `ritsu_semantic_index_build / search / graph_rerank` 已写入并返回 `artifact_layer`

因此当前更准确的理解是：五类主链路产物已打通，legacy 保留兼容。

对 runtime 的实施原则应理解为：

- `primary` 产物优先
- `evidence` 产物补充解释
- `compatibility` 产物只为迁移期或旧调用方保留

ctx 事件里的 `skill` 字段也仍保留兼容命名：

- `route` = `intake`
- `pipe` = `deliver`
- `review` = `assure`

也就是说，ctx 恢复和事件审计看到的是底层兼容 `skill` 值；产品解释仍按 `intake / deliver / assure` 阅读。
若看到 `think`，应理解为 `deliver` 内部的设计/诊断模块，而不是额外的产品入口。

`ritsu_read_ctx` 现在同时返回两层信息：

- `recovery_context.skill` / `circuit_breaker_status.should_redirect` = 底层兼容 `skill` 值
- `recovery_context.stage` / `circuit_breaker_status.recommended_stage` = 产品阶段语义

同样，`last_incomplete` 与 `last_completed` 也会附带 `stage`，这样整个恢复相关返回结构保持一致。
`recent_entries` 与 `recent_entries_pruned` 现在也会附带 `stage`，因此所有主要 ctx 事件视图都能直接按产品阶段消费。

产物层级解释统一见：

- `_shared/artifact-layers.md`

按当前约定：

- `intake-ticket / delivery-plan / delivery-report / assurance-report / release-advice` = 主链路产物
- `handoff / diagnosis / optimize-report` = 过程证据产物
- `review-stamp` = 兼容镜像产物

其中 `ritsu_contract_validate` 当前语义为：

- 它校验的是“实施契约”，因此是分层消费规则下的特例
- 优先读取最新 `handoff-*`
- 若不存在则回退到最新 `intake-ticket-*`
- `delivery-report` 与 `assurance-report` 仍不作为实施契约来源
- 返回中的 `artifact_path / artifact_type` 是当前主字段；`handoff_path` 仅为兼容旧调用方保留，当前语义等同 `artifact_path`

而历史检索工具的默认消费顺序应理解为：

- 先查 `primary`
- 不足时再查 `evidence`
- 必要时才查看 `compatibility`

主产物模板当前统一维护在：

- `_shared/artifact-templates.md`

若调整 `intake-ticket / delivery-plan / delivery-report / assurance-report / release-advice` 的章节名或字段标签，必须同时检查：

- `_shared/artifact-schema.yaml`
- `_shared/artifact-templates.md`
- `_shared/mcp-tools.yaml`
- `skills/route|pipe|review/SKILL.md`（当前兼容文件名，对应 `intake / deliver / assure`）

---

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `RITSU_PROJECT_ROOT` | `process.cwd()` | 目标项目根目录 |
| `RITSU_SHARED_DIR` | 内置解析 | 可选，共享协议目录覆盖 |

---

## 开发

```bash
npm run dev
npm run lint
npm run build
npm run test
```

---

## 现阶段原则

当前 runtime 的演进原则很简单：

- 先把产品面和协议层讲清楚
- 再让 `Core Stable` 工具层逐步做硬
- `Advanced Plugin` 只在证明确实带来收益时才抬升地位
- 不用夸大实验能力的默认可靠性
