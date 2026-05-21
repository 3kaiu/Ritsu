# Ritsu Architecture (v7.0)

## 六层架构

```text
Skills (Markdown 协议)        ─→  7 个 SKILL.md (用户唯一界面)
Orchestration                 ─→  preflight-runner, internal-tools, diff-inspect
MCP Handler Layer             ─→  22 个 handler (对用户透明)
Policy Engine                 ─→  plugin-loader + 8 detectors
Storage Layer                 ─→  ctx-reader/writer, ctx-db (SQLite), session-memory
Native Engine                 ─→  Rust napi-rs 向量搜索
CLI Layer                     ─→  cli/: doctor, cat, trace, export, sync, mine, bootstrap
```

| 层 | 职责 | 技术 |
|---|---|---|
| **Skills** | 阶段剧本，AI 可读的 Markdown 协议 | `skills/<stage>/SKILL.md` |
| **Orchestration** | 按 stage 串联 ctx、diff、policy、底层工具 | `orchestration/` |
| **Handlers** | 22 个 MCP 工具实现 | `handlers/` |
| **Policy** | 策略引擎，8 个检测器 + 插件系统 | `policy/` |
| **Storage** | JSONL + SQLite 双写，向量记忆 | `ctx-*.ts`, `session-memory.ts` |
| **Native** | Rust napi-rs 向量搜索 | `native/` |
| **CLI** | doctor, cat, trace, mine, sync | `cli/` |

## 运行时

- **包管理器**: Bun 1.3+
- **构建**: `bun run build`
- **测试**: 60 文件, 344 测试, vitest
- **原生引擎**: Rust napi-rs（可选，纯 JS 回退）

## 底层工具编排

Ritsu 在 orchestration 层自动调用多个底层工具，对用户完全透明：

| 功能 | 触发时机 | 实现 |
|------|---------|------|
| 代码图分析 | preflight dev/review | `internal-tools.fetchCodeGraphContext()` |
| 需求头脑风暴 | preflight think | `internal-tools.runSuperpowersBrainstorming()` |
| 规格同步 | preflight think (P2) | `openspec-bridge.ts` |
| 文档注入 | bootstrap 自动配置 | Context7 MCP |
| 浏览器测试 | quality-gates | Playwright MCP |
| 仓库操作 | preflight/review | GitHub MCP |

## Policy 引擎

```
写入时: ritsu_write_artifact → evaluatePolicies
交付前: preflight / quality-gates → runPolicyPreflight
```

8 个内置检测器 + 用户插件 (`rules/detectors/*`)。

## 关键设计决策

- **用户只看到 Skills** — `/r-think` → `/r-dev` → `/r-review` → `/r-hunt`
- **底层工具完全透明** — bootstrap 自动配置，preflight 自动调用
- **22 个 MCP 工具** — 已合并 10 个旧工具
