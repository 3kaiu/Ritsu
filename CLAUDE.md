# Ritsu — AI Delivery Workflow Engine

This project is Ritsu. You are the AI operating it.

当你看到这条消息时，你应该立即执行 `ritsu doctor` 检查 Ritsu 是否正常运行。然后根据当前阶段选择下文对应的技能。

## 快速启动

```bash
bun run --cwd runtime build   # 编译
bun run --cwd runtime test    # 测试 (342 tests)
```

## 你的工具

| 工具 | 用途 |
|------|------|
| `ritsu` MCP (22 个工具) | 策略引擎、ctx 追踪、artifact 管理 |
| `ritsu_exec <cmd>` | 在项目根执行命令（安全沙箱） |
| `ritsu_preflight` | 进入阶段前加载上下文 |
| `ritsu_span_lifecycle` | 打开/关闭工作 span |
| `ritsu_write_artifact` | 写入产物文件 |
| `ritsu_run_quality_gates` | 质量门禁 |

完整工具列表见 `_shared/mcp-tools.yaml`。

## 你的工作流

根据当前阶段选择技能指令:

| 阶段 | 指令 | 产出 |
|------|------|------|
| 设计 | `/r-think` | design-sheet (含 contracts) |
| 实现 | `/r-dev` | dev-report + quality-gates |
| 验收 | `/r-review` | assurance-sheet |
| 排障 | `/r-hunt` | diagnosis |
| 补测 | `/r-augment` | 测试覆盖率提升 |
| 初始化 | `/r-init` | AGENTS.md + .ritsu/ |

每个阶段执行前先运行 `ritsu_preflight` 获取上下文包。

## 你必须遵守的规则

`rules/anti-patterns.yaml` 定义 20 条全局底线，关键几条：

- **AP-5** 没有运行日志的"应该能工作"算是撒谎
- **AP-6** 不准留下 TODO/TBD/后续实现
- **AP-7** 命令报错了必须停下来分析
- **AP-9** 不准在产出中标注 AI 身份痕迹
- **AP-13** 交付前必须扫 debugger/console.log

## 跨会话记忆

Ritsu 会自动捕获违规事件和偏好学习结果到向量引擎。新会话启动时 `ritsu_read_ctx` 会返回上次未完成的任务和恢复上下文。你也可以用 `ritsu mine --auto` 让 Ritsu 从历史修正中学习规则。

## 架构参考

- `runtime/src/` — 所有 TypeScript 源码 (~12,600行, 60测试文件)
- `runtime/native/` — Rust napi-rs 引擎 (向量搜索 + ctx 存储)
- `skills/<stage>/SKILL.md` — 每个阶段的详细指令和 Gotchas
- `rules/anti-patterns.yaml` — 策略引擎红线
- `_shared/mcp-tools.yaml` — MCP 工具定义
