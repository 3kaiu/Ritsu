# Context Loader: 强制上下文装载器 (Ritsu) v3.4.0

这是 Ritsu 架构体系的底层协议。无论当前触发的是哪个 `/r-` 技能，在执行任何实质性动作之前，**必须**首先在后台静默执行此装载序列。

> **隐式执行声明**：本装载器由系统自动执行，各 skill 无需在文档中显式声明 Pre-flight 或引用本文件。`__RITSU_LOADED__` 标记由本装载器管理，skill 中不得重复声明。

## 强制装载序列

### Phase 1: 项目基线加载 (Baseline Retrieval)

- 立即读取当前目录或根目录下的 `AGENTS.md`（由 `/r-init` 生成的 Layer 3 项目约束）。
- 如果没找到 `AGENTS.md`：
  - **非 `/r-init` 技能**：发出警告 “⚠️ 未发现 AGENTS.md，将自动触发 /r-init 完成项目初始化。” 并自动执行 `/r-init` 的装载逻辑，完成后继续当前技能。
  - **`/r-init` 本身**：正常继续，因为 init 的职责就是生成此文件。
- 如果找到 `AGENTS.md`：校验其 `last_updated` 时间戳。若距当前超过 7 天，发出提示 “💡 AGENTS.md 已超过 7 天未更新，建议执行 /r-init:refresh 刷新基线。” 但不阻塞。

### Phase 2: 状态推断 (State Inference)

- 按 `state-machine.yaml` 中的状态推断规则，确定当前项目状态。
- 将推断结果注入当前技能的执行上下文，供跳步拦截使用。

### Phase 3: 环境与依赖并行确认 (Environment & Dependency Lock)

以下两项**并发执行**：

- **环境变量与配置确认**：
  - 绝对禁止背诵“常见的”配置。
  - 必须通过 `cat`、`grep` 或同等工具，读取 `package.json`、`.env`、`pom.xml`、`.cursorrules` 等真实配置文件，抓取当前项目的**真实框架版本**和**真实运行端口**。

- **依赖收束与安全检查**：
  - 确认当前技能执行时，只能使用 `AGENTS.md` 中规定的技术栈（例如，规定了状态管理用 Zustand，就不准擅自引入 Redux）。
  - **新增依赖安全检查**：若技能执行中需要引入新依赖，必须检查：版本兼容性（与现有锁文件是否冲突）、已知安全漏洞（`npm audit` / `pip audit` 等同工具）、License 合规性。

### Phase 4: 领域配置装载 (Domain Loading)

- 从 `AGENTS.md` 读取 `domain` 字段。
- 加载 `domains/_base.yaml`（通用基线，始终装载）。
- 加载 `domains/[domain].yaml`（领域增量）。
- 若为 fullstack 领域，同时加载 `domains/frontend.yaml` 和 `domains/backend.yaml`。
- **按需加载 section**：仅加载当前 skill 声明的 `required_sections`，跳过无关 section 节省 Token：

| Skill    | 加载 sections                                                                 | 跳过 sections                                                                                          |
| -------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| route    | 无需加载 domain                                                               | 全部                                                                                                   |
| init     | `hypothesis_directions`                                                       | `coding_disciplines`, `attack_vectors`, `optimize_*`                                                   |
| think    | `hypothesis_directions`, `coding_disciplines`                                 | `attack_vectors`, `optimize_*`                                                                         |
| dev      | `coding_disciplines`, `attack_vectors`                                        | `hypothesis_directions`, `optimize_disciplines`, `optimize_tool_preferences`, `platform_optimizations` |
| optimize | `optimize_disciplines`, `optimize_tool_preferences`, `platform_optimizations` | `hypothesis_directions`, `coding_disciplines`, `attack_vectors`                                        |
| review   | `attack_vectors`, `coding_disciplines`                                        | `hypothesis_directions`, `optimize_*`                                                                  |
| hunt     | `hypothesis_directions`                                                       | `coding_disciplines`, `attack_vectors`, `optimize_*`                                                   |
| triage   | 无需加载 domain                                                               | 全部                                                                                                   |

- 设置 **已装载标记**：`__RITSU_LOADED__ = true`，后续技能的 Pre-flight/步骤 1 检测到此标记后跳过重复装载。

> **装载完成后，系统才被允许进入具体技能的流水线逻辑。**
