# Ritsu Architecture (v6.1)

Claude Code 为默认主机；编排单入口；Policy 单内核；MCP 面受控收缩。

## 三层

```text
Skills (Claude marketplace)  →  ritsu_preflight  →  Core (policy / ctx / artifacts)
```

| 层 | 职责 | 对外入口 |
| --- | --- | --- |
| **Skills** | 阶段剧本（think/dev/hunt/review） | `/r-*` 指令 |
| **Orchestration** | 按 stage 串联 ctx、diff、policy、OpenSpec | `ritsu_preflight` |
| **Core** | 证据链、策略引擎、质量门禁 | handlers + CLI |

实现目录：`runtime/src/orchestration/`（preflight-runner、policy-preflight、diff-inspect）。

## 主机矩阵

| 主机 | 必需文件 | 可选 |
| --- | --- | --- |
| **Claude Code** | 项目根 `.mcp.json`、`.ritsu/ecosystem.json` | `claude mcp add` 等价于 bootstrap |
| **Claude Desktop** | 用户级 MCP 配置（见 `docs/mcp-claude-desktop.example.json`） | — |
| **Cursor** | `.cursor/mcp.json`（`ritsu bootstrap --host all`） | hooks（`--include-cursor-hooks`） |

默认 `ritsu bootstrap` 仅写 **`.mcp.json`**，`host_profile: claude-code`。

## Policy 双触发

1. **写入时**：`ritsu_write_artifact` → `evaluatePolicies`
2. **交付前**：`ritsu_preflight` / `run_quality_gates` → `runPolicyPreflight`（30s worktree 缓存去重）

`ritsu_policy_check` 不对外暴露（见 `_shared/mcp-tools-internal.yaml`）。

## Diff 检视

统一工具 **`ritsu_inspect_diff`**：`mode=stat|chunks|full`。  
`ritsu_get_diff` / `ritsu_diff_chunks` 仅保留 handler 别名，不在 MCP 清单注册。

## 禁止清单（反指标 R-15）

不纳入 Ritsu core：

- 第二套编排框架（LangGraph 等）
- LiteLLM / 模型路由层
- IDE 本体或 Cursor hooks 默认生成
- 与 preflight 重复的 SKILL 手工步骤

新增 MCP 工具须 **删一增一** 或合并旧工具；当前对外约 **25** 个，目标 ≤23（lease 三件套合并留 v6.2）。

## 用户旅程（Claude-first）

```text
npx skills add 3kaiu/Ritsu -a claude-code -g -y
/r-init  →  ritsu_bootstrap_ecosystem  →  .mcp.json
重载 Claude Code MCP
ritsu doctor --ecosystem
/r-think | /r-dev | /r-hunt | /r-review  （每阶段一步 ritsu_preflight）
```
