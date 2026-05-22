# Ritsu — AI Delivery Skill Engine

Ritsu is **two things**:

1. **A skill** — 你给我 6 个指令 (`/r-think`, `/r-dev`, `/r-review`, `/r-hunt`, `/r-augment`, `/r-init`)，我引导你完成完整的交付流程
2. **An engine** — 你只需要跟我交互，底层我自动编排其他 skill、MCP 工具、协议、插件

## 你不用关心底层

Ritsu 自动帮你处理以下所有事情，你不需要直接调用它们：

| Ritsu 自动做 | 底层能力 |
|-------------|---------|
| 进入 think 前拉取设计上下文 | Superpowers brainstorming (如有) |
| preflight 时分析代码影响 | CodeGraph 代码图 |
| 设计阶段自动同步规格 | OpenSpec 协议 |
| 写入 artifact 时拦截违规 | 11 个策略检测器 + 用户插件 |
| diff 时检测架构漂移 | architecture-analyzer + blast-radius |
| 完成时质量门禁 | lint + test + adaptive coverage |
| 跨会话记忆 | bun:sqlite + 向量存储 + 语义检索 |
| 从你的修正中学习 | 启发式 + LLM 规则合成 (5 patterns) |

## 你的接口

你只通过 6 个指令与 Ritsu 交互。每个指令对应 `skills/<stage>/SKILL.md`。

| 执行 | 指令 | 读这个文件 |
|------|------|-----------|
| Think | `/r-think` | `skills/think/SKILL.md` |
| Dev | `/r-dev` | `skills/dev/SKILL.md` |
| Review | `/r-review` | `skills/review/SKILL.md` |
| Hunt | `/r-hunt` | `skills/hunt/SKILL.md` |
| Augment | `/r-augment` | `skills/augment/SKILL.md` |
| Init | `/r-init` | `skills/init/SKILL.md` |

执行前先调 `ritsu_preflight` 获取 `_ai_summary`——读一行就知道当前状态和下一步。

## Install

```bash
npx skills add 3kaiu/Ritsu -a claude-code -g -y
```

之后重载 MCP，运行 `ritsu doctor` 确认。

## ⚡️ Prompt Caching (提示词缓存) 协议

为最大化 Anthropic/DeepSeek 缓存命中率（降低 90% 成本，缩短 80% 延迟），你必须严格遵循以下 **Prompt 缓存加载顺序**：

1. **第 1 步：加载静态底座 (Static Prefix)**：在会话启动时，**最前端**必须以静态方式加载：
   - `rules/anti-patterns.yaml`（全局底线，所有阶段共享）
   - `_shared/mcp-tools.yaml`（工具 Schema 定义）
   - 仅当阶段为 `think` 时：`_shared/skill-common-steps.md` 的 Step -2（缓存对齐协议）

   这建立了 > 1024/2048 字节的缓存块。

2. **第 2 步：加载阶段技能指令 + 阶段专属规则**：随后读取当前指令对应的 `skills/<stage>/SKILL.md`，以及阶段专属规则文件：
   - `dev` 阶段额外加载 `rules/dev-guardrails.yaml`（DG-1 至 DG-4）
   - `review` 阶段额外加载 `rules/review-redlines.yaml`（R-1 至 R-8，三方对账）

3. **第 3 步：加载易变动态上下文 (Suffix Zone)**：最后在 Prompt 尾部追加极易变动的数据。

⚠️ **绝对禁止**：在加载静态底座前或加载中间，夹杂任何易变/动态数据（如当前任务描述或具体 diff 文件内容），否则会导致前面的 Prompt 缓存失效！

### Suffix Zone Marker

`ritsu_preflight` 的 context_pack 包含 `_suffix: true` 字段，标识该 pack 属于 Suffix Zone。
AI **必须**将 _suffix pack 的内容整体放置在 Prompt 最末尾（Stage 3），不得将其中的任何字段提升到 Stage 1 或 Stage 2。

```
正确顺序:
  anti-patterns.yaml → mcp-tools.yaml → SKILL.md → [全部动态数据，含 _suffix pack]
                                                                    ↑
                                                           从这里开始所有动态内容
```

## 你必须遵守

`rules/anti-patterns.yaml` 定义 20 条底线（必须在第 1 步优先加载）：

- **AP-5**: 没有命令输出就不要说"通过了"
- **AP-6**: 不准留 TODO/TBD
- **AP-7**: 报错了就停下来分析
- **AP-9**: 产出不留 AI 痕迹
- **AP-13**: 交付前扫 debugger/console.log

## 架构参考

- `skills/<stage>/SKILL.md` — 技能指令 + Gotchas
- `runtime/src/orchestration/` — 引擎编排层 (preflight, internal tools, architecture)
- `runtime/src/handlers/` — 8 个 MCP 工具 (整合后)
- `runtime/src/policy/` — 策略引擎 + 11 个检测器 + blast-radius + import-graph
- `runtime/src/similarity.ts` — 统一 Jaccard/Cosine 相似度
- `_shared/mcp-tools.yaml` — MCP 工具 Schema 声明
