# Ritsu MCP Server Runtime (v4.0.0)

`runtime/` 是 Ritsu 的工具执行层。它为显式工作流提供原子工具支持，并维护系统的协议一致性。

## 核心职责

1.  **状态与产物管理**：
    *   `ctx` 事件流的持久化与检索。
    *   `artifact` 的 Schema 校验与原子写入。
2.  **工作区感知**：
    *   结构化的变更获取 (Diff / Changed Files)。
    *   环境探测与安全执行环境。
3.  **交付保证**：
    *   质量门禁 (Quality Gates) 的统一执行。
    *   技术契约 (Contract) 的自动化校验。
4.  **智能增强**：
    *   语义搜索 (Semantic Search) 与向量化记忆。
    *   知识图谱 (KG) 提取与查询。
    *   TS 符号解析与类型推断。

---

## 工具分层 (Tool Hierarchy)

### 核心稳定工具 (Core Stable)
- `ritsu_emit_event`: 记录工作流事件。
- `ritsu_read_ctx`: 读取会话情景记忆。
- `ritsu_write_artifact`: 写入结构化产物 (Design Sheet / Assurance Sheet / Dev Report)。
- `ritsu_list_artifacts`: 列出并过滤产物。
- `ritsu_get_diff` / `ritsu_get_changed_files`: 获取代码变更证据。
- `ritsu_run_quality_gates`: 执行 Lint/Test 等质量门禁。

### 专家级增强工具 (Expert Plugins)
- `ritsu_contract_validate`: 校验 API/组件契约覆盖率。
- `ritsu_semantic_search`: 跨会话语义检索。
- `ritsu_ts_symbol_query`: 深度分析 TS 类型与调用链。
- `ritsu_env_probe`: 识别当前工程的技术指纹。

---

## 协议一致性 (Protocol Alignment)

自 v4.0.0 起，Runtime 强制遵循以下收拢后的产物协议：

*   **Primary (主产物)**: `design-sheet` / `dev-report` / `assurance-sheet`
*   **Evidence (证据产物)**: `handoff` / `diagnosis` / `optimize-report`
*   **System (系统产物)**: `ctx`

不再支持 `think-ticket` / `think-plan` / `review-report` 等 3.x 版本的旧名称别名。

---

## 快速开始

```bash
cd runtime
npm install
npm run build
npm start
```

---

## 仓库结构

```text
runtime/src/
├── index.ts            # MCP Server 启动入口
├── shared.ts           # 共享常量与产物映射
├── ctx-reader.ts       # 会话历史解析
├── ctx-writer.ts       # 事件流写入
└── handlers/           # 原子工具的具体实现
```
