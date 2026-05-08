---
name: init
description: "Ritsu 初始化协议。当 AI 首次进入一个新项目时执行。负责扫描项目架构、提取技术栈与规范，生成项目级基准文件 (AGENTS.md) 并配置强路由拦截。"
when_to_use: "/r-init, 初始化, 初始化项目"
metadata:
  version: "1.1.0"
---

# Init: 初始化项目约束基线 (Project Foundation)

**触发条件**：用户输入 `/r-init` 或指明需要初始化。

## 核心职责 (Capability Convergence)
只做一件事：扫描当前项目，提取约束，并生成项目级配置文件，**绝对不写业务代码**。

## 执行流水线

### 1. 强制寻址
- 立即执行 `pwd` 确认当前目录。
- 检查当前目录下是否已存在 `AGENTS.md`。如果存在，询问用户是否覆盖，未经允许绝对不覆盖。

### 2. 深度扫描提取
并发或依次执行以下检查，用真实读取替代猜测：
- **技术栈提取**：通过读取真实的 `package.json`, `pom.xml`, `go.mod` 锁定语言、框架、状态管理、路由方案版本。
- **架构模式提取**：采样 3-5 个核心文件，判断分层结构（MVC, MVVM, 领域驱动等），检查依赖注入与数据流特征。
- **质量门禁提取**：读取 `Makefile`, `.github/workflows/`, `package.json scripts`，必须提取到能实际运行的静态检查 (Lint) 与测试 (Test) 运行命令。如果找不到，显式标记为“需补充”。

### 3. 生成项目基 (AGENTS.md)
在项目根目录强制生成 `AGENTS.md`（作为 Layer 3 纯粹项目级约束）。格式如下：

```markdown
# [自动提取的项目名称] 核心开发约束 (Layer 3)

## 1. 技术栈底座
- 语言: 
- UI框架: 
- 状态/网络: 

## 2. 架构与目录法则
- (提取到的目录规范与分层要求，指明模块间依赖方向)

## 3. 质量门禁 (Quality Gates)
- 验证命令: `[真实的测试/Lint命令，例如 npm run test]` 
> 警告：每次 /r-dev 和 /r-review 结束后必须全量运行以上命令。
```

### 4. 路由挂载 (IDE Rules Namespace Mapping)
在项目根目录隐式生成或更新IDE配置文件（如 Cursor 生成 `.cursorrules`，Windsurf 生成 `.windsurfrules`）：
必须明确声明对 **Ritsu 专属指令前缀 (/r-)** 的拦截：
```text
如果你是一个在当前 IDE 中的 AI：
1. 你的全局基础约束，受 `~/.gemini/antigravity/skills/Ritsu` 的规则控制。
2. 本项目的具体业务规则，受根目录 `AGENTS.md` 约束。
3. 严格指令前缀路由（看到以下前缀，立即放弃闲聊，直接加载对应能力）：
   - `/r-think` -> 侧重防腐设计、回滚推演、架构攻击测试。
   - `/r-dev` -> 侧重死抠细节、防编造标识符、零占位符纯净开发。
   - `/r-review` -> 侧重化身安全专家/黑客进行底线拦截。
   - `/r-hunt` -> 侧重悬案诊断、看病查日志，绝对不改代码。
   - `/r-triage` -> 侧重冷酷事实驱动的 Issue/PR 分诊与处置。
```

## 关联调用流转 (Sequential Invocation)
一切就绪后，直接输出成功摘要，并在末尾附加以下精确引导词，等待用户进入下一步：

> "✅ 律 (Ritsu) 初始化完毕，项目基准 `AGENTS.md` 已生效。
> 接下来：
> - 构思新特性，请输入：**`/r-think [特性描述]`**
> - 直接开始写代码，请输入：**`/r-dev [需求描述]`**"
