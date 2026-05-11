# Ritsu MCP Server Runtime

> v3.6.0 · 将 `_shared/mcp-tools.yaml` 协议声明编译为可运行的 MCP 工具服务

## 快速开始

```bash
cd runtime
npm install
npm run build
npm start
```

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

在 `claude_desktop_config.json` 中添加：

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

## 架构

```
runtime/src/
├── index.ts            # MCP Server 入口（stdio transport）
├── schema-compiler.ts  # mcp-tools.yaml → JSON Schema 编译器
├── event-validator.ts  # ctx-event-schema.json + ajv 校验
├── ctx-store.ts        # .ritsu/ctx JSONL 读写 + correlation_id 生成
└── handlers/
    └── index.ts        # 9 个工具运行时 handler
```

## 工具清单

| 工具                      | 功能                                            |
| ------------------------- | ----------------------------------------------- |
| `ritsu_emit_event`        | 事件写入 + Schema 校验（4 种核心事件）          |
| `ritsu_read_ctx`          | ctx 状态查询 + 恢复上下文 + 现实对账 + 熔断状态 |
| `ritsu_write_artifact`    | 产物写入 + 占位符拦截（统一 Markdown）          |
| `ritsu_list_artifacts`    | .ritsu/ 目录扫描 + 类型过滤                     |
| `ritsu_exec`              | 通用命令执行（白名单 + 截断/超时）              |
| `ritsu_validate`          | 独立 Schema 校验                                |
| `ritsu_get_changed_files` | 变更文件列表 + 领域推断                         |
| `ritsu_get_diff`          | 结构化 diff 分析 + 新增标识符提取               |
| `ritsu_run_quality_gates` | Lint + Test 质量门禁 + 失败用例解析             |

## 环境变量

| 变量                 | 默认值          | 说明           |
| -------------------- | --------------- | -------------- |
| `RITSU_PROJECT_ROOT` | `process.cwd()` | 目标项目根目录 |

## 开发

```bash
npm run dev     # tsc --watch
npm run lint    # tsc --noEmit
npm run build   # tsc
```
