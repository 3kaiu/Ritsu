---
name: init
description: "Ritsu 初始化协议。当 AI 首次进入一个新项目时执行。负责扫描项目架构、提取技术栈与规范，生成项目级基准文件 (AGENTS.md) 并配置路由。"
when_to_use: "/init, 初始化, 初始化项目"
metadata:
  version: "1.0.0"
---

# Init: 初始化项目约束基线 (Project Foundation)

**触发条件**：用户输入 `/init` 或指明需要初始化。

## 核心职责 (Capability Convergence)
只做一件事：扫描当前项目，提取约束，并生成项目级配置文件，**绝对不写业务代码**。

## 执行流水线

### 1. 强制寻址
- 立即执行 `pwd` 确认当前目录。
- 检查当前目录下是否已存在 `AGENTS.md`。如果存在，询问用户是否覆盖。

### 2. 深度扫描提取
并发或依次执行以下检查：
- **技术栈提取**：读取 `package.json`, `pom.xml`, `go.mod` 等依赖文件。锁定语言、核心框架、状态管理、路由方案。
- **架构模式提取**：采样 3-5 个核心文件，判断分层结构（MVC, MVVM, 领域驱动等），检查依赖注入与数据流。
- **质量门禁提取**：读取 `Makefile`, `.github/workflows/`, `scripts`，提取核心的静态检查 (Lint) 与测试 (Test) 运行命令。

### 3. 生成项目基 (AGENTS.md)
在项目根目录强制生成 `AGENTS.md`（作为 Layer 3 纯粹项目级约束）。格式如下：

```markdown
# [自动提取的项目名称] 核心开发约束 (Layer 3)

## 1. 技术栈底座
- 语言: 
- UI框架: 
- 状态/网络: 

## 2. 架构与目录法则
- (提取到的目录规范与分层要求)

## 3. 质量门禁 (Quality Gates)
- 验证命令: `[提取到的测试/Lint命令]` (每次 /dev 和 /review 后必须运行)
```

### 4. 路由挂载 (IDE Rules)
为了支持 IDE 原生拦截短指令，在项目根目录生成对应的隐式配置文件（如存在对应 IDE 环境）：
- **Cursor**: 生成 `.cursorrules`。
- **Windsurf**: 生成 `.windsurfrules`。
内容要求极简，仅写入指令路由映射（绝不可将全局 AI 规则抄进此文件）：
```text
如果你是一个在 Cursor/Windsurf 中的 AI：
1. 你的基础开发规则，受 `~/.gemini/antigravity/skills/Ritsu` 的系统约束。
2. 本项目的具体业务规则，受根目录 `AGENTS.md` 约束。
3. 当用户输入指令时，触发对应通道：
   - 输入 `/think` -> 侧重于方案分析与防腐设计。
   - 输入 `/dev` -> 侧重于无偏离的严谨编码实现。
   - 输入 `/review` -> 侧重于对抗性代码审查。
   - 输入 `/triage` -> 侧重于极简 Issue/PR 回复。
```

## 关联调用流转 (Sequential Invocation)
一切就绪后，直接输出成功摘要，并在末尾附加以下精确引导词，等待用户进入下一步：

> "✅ 律 (Ritsu) 初始化完毕，项目基准 `AGENTS.md` 已生成并生效。
> 接下来：
> - 如果你想构思新特性，请输入：**`/think [特性描述]`**
> - 如果你想直接开始写代码，请输入：**`/dev [需求描述]`**"
