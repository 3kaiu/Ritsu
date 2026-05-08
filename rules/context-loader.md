# Context Loader: 强制上下文装载器 (Ritsu)

这是 Ritsu 架构体系的底层协议。无论当前触发的是哪个 `/r-` 技能，在执行任何实质性动作之前，**必须**首先在后台静默执行此装载序列。

## 强制装载序列

1. **项目基线加载 (Baseline Retrieval)**
   - 立即读取当前目录或根目录下的 `AGENTS.md`（由 `/r-init` 生成的 Layer 3 项目约束）。
   - 如果没找到 `AGENTS.md`，立即停止并报错：“未发现 AGENTS.md，请先运行 `/r-init` 完成项目初始化。”

2. **环境变量与配置确认 (Environment Lock)**
   - 绝对禁止背诵“常见的”配置。
   - 必须通过 `cat`、`grep` 或同等工具，读取 `package.json`、`.env`、`pom.xml`、`.cursorrules` 等真实配置文件，抓取当前项目的**真实框架版本**和**真实运行端口**。

3. **依赖收束 (Dependency Scope)**
   - 确认当前技能执行时，只能使用 `AGENTS.md` 中规定的技术栈（例如，规定了状态管理用 Zustand，就不准擅自引入 Redux）。

> **装载完成后，系统才被允许进入具体技能的流水线逻辑。**
