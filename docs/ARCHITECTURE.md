# Ritsu Architecture (v7.0)

## 六层架构

```text
Skills (Markdown 协议)        ─→  7 个 SKILL.md (think/dev/review/hunt/augment/init/freestyle)
Orchestration                 ─→  preflight-runner, diff-inspect, superpowers-bridge
MCP Handler Layer             ─→  22 个 handler (合并后)
Policy Engine                 ─→  plugin-loader + 8 detectors (含 codegraph)
Storage Layer                 ─→  ctx-reader/writer, ctx-db (SQLite), session-memory
Native Engine                 ─→  Rust napi-rs: vector_store (sqlite-vec cosine)
CLI Layer                     ─→  cli/: doctor, cat, trace, export, sync, mine, bootstrap
```

| 层 | 职责 | 技术 |
|---|---|---|
| **Skills** | 阶段剧本，AI 可读的 Markdown 协议 | `skills/<stage>/SKILL.md` |
| **Orchestration** | 按 stage 串联 ctx、diff、policy、图上下文 | `orchestration/` |
| **Handlers** | 22 个 MCP 工具实现，全部收敛 | `handlers/` |
| **Policy** | 策略引擎，8 个检测器 + 插件系统 | `policy/` |
| **Storage** | JSONL + SQLite 双写，向量记忆 | `ctx-*.ts`, `session-memory.ts` |
| **Native** | Rust napi-rs，向量搜索 | `native/` (Rust) |
| **CLI** | doctor, cat, trace, mine, sync | `cli/` |

## 运行时

- **包管理器**: Bun 1.3+（已迁移，移除 npm）
- **构建**: `bun run build` → tsc + copy-resources
- **测试**: vitest — `bun run test`（314 tests, 56 files）
- **原生插件**: Rust napi-rs，可选，纯 JS 回退

## 外部集成

| 项目 | 集成方式 | 状态 |
|---|---|---|
| **Superpowers** | `superpowers-bridge.ts` — 阶段映射 + preflight 路由 | ✅ 自动检测 |
| **CodeGraph** | `codegraph` 检测器 + preflight 图上下文 + MCP bootstrap | ✅ CLI fallback |
| **OpenSpec** | `openspec-bridge.ts` — /opsx: 命令 + contract 提取 | ✅ |
| **Waza** | 反模式目录 + Gotchas 表 + 验证优先硬停止 | ✅ CLAUDE.md |
| **Claude-Mem** | `session-memory.ts` — 3 层渐进式记忆 + auto-capture | ✅ native 引擎 |

## Policy 引擎

```
写入时: ritsu_write_artifact → evaluatePolicies (plugin-loader)
交付前: preflight / quality-gates → runPolicyPreflight (30s worktree 缓存去重)
```

8 个内置检测器: regex, cross_file, scope_diff, contract_coverage, preference_lint, ast_grep, ast, codegraph
用户插件: `rules/detectors/*.js` + `manifest.json`

## 存储

- **事件日志**: JSONL + SQLite 双写（bun:sqlite 优先）
- **向量记忆**: Rust napi-rs 引擎 + JSONL 回退
- **偏好**: `.ritsu/preferences.yaml` → AST-grep 规则编译

## 关键设计决策

- **22 个 MCP 工具** — 已合并 10 个旧工具，不新增
- **不嵌入**: 通过 MCP 组合而非内部重写（CodeGraph、Codex++ 插件模式）
- **Claude Code 优先**: CLAUDE.md + `.claude/rules/` + `.claudeignore`
- **渐进式 Token 控制**: ritsu_read_ctx 支持 token_budget 参数
