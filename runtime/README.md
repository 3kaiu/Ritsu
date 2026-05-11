# Ritsu MCP Server Runtime

> Runtime: `3.5.1` · Protocol: `v3.8.0`

`runtime/` 是 Ritsu 的工具执行层，不负责定义产品入口。  
产品面已经收敛为 `intake / deliver / assure`，而 runtime 的职责是提供这些阶段会调用到的稳定工具和增强工具。

当前状态需要明确区分两层：

1. **产品语义**：`intake / deliver / assure`
2. **运行时现实**：仍主要围绕 legacy 产物 `handoff / diagnosis / review-stamp / optimize-report`，但部分工具已开始接入 `intake-ticket / delivery-report / assurance-report`

这意味着：

- README 和 skill 文档已经按新模型收敛
- runtime 仍在逐步对齐，不应把尚未完全落地的能力包装成默认承诺

---

## 快速开始

```bash
cd runtime
npm install
npm run build
npm start
```

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

### Stable

这些工具适合主链路依赖：

- `ritsu_emit_event`
- `ritsu_read_ctx`
- `ritsu_read_agents`
- `ritsu_write_artifact`
- `ritsu_list_artifacts`
- `ritsu_exec`
- `ritsu_get_changed_files`
- `ritsu_get_diff`
- `ritsu_run_quality_gates`

### Conditional

这些工具可以进入主链路，但需要清楚理解其当前语义边界：

- `ritsu_contract_validate`

### Advanced

这些工具更适合作为增强项，不应默认包装成“总能自动搞定”：

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

虽然产品语义已经转向 `intake / deliver / assure`，runtime 当前的主产物仍然是：

- `handoff-*`
- `diagnosis-*`
- `review-stamp-*`
- `optimize-report-*`
- `ctx-*`

`intake-ticket / delivery-report / assurance-report` 已进入 schema 和部分运行时能力层，但整体迁移仍未完成。

其中 `ritsu_contract_validate` 当前语义为：

- 优先读取最新 `handoff-*`
- 若不存在则回退到最新 `intake-ticket-*`
- `delivery-report` 与 `assurance-report` 仍不作为实施契约来源

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
- 再让工具层逐步对齐
- 不用夸大高级能力的默认可靠性
