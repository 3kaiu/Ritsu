---
name: init
description: "Ritsu 初始化协议。当 AI 首次进入一个新项目时执行。负责扫描项目架构、提取技术栈与规范，生成项目级基准文件 (AGENTS.md) 并配置强路由拦截。"
when_to_use: "/r-init, 初始化, 初始化项目"
metadata:
  version: "3.0.0"
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
- **架构模式提取**：采样策略——按以下优先级选取 5-8 个核心文件：
  1. 入口文件（`index.ts`, `main.go`, `App.tsx`）
  2. 路由/控制器文件（最深依赖层）
  3. 数据模型/Schema 文件（数据层）
  4. 体积最大的 2 个业务文件（复杂度热点）
  5. 配置/环境文件
     判断分层结构（MVC, MVVM, 领域驱动等），检查依赖注入与数据流特征。
- **质量门禁提取**：读取 `Makefile`, `.github/workflows/`, `package.json scripts`，必须提取到能实际运行的静态检查 (Lint) 与测试 (Test) 运行命令。如果找不到，显式标记为"需补充"。
- **领域识别与确认**：根据技术栈和架构模式，自动推断项目所属领域（frontend/backend/fullstack/data/devops），**必须向用户展示推断结果并要求确认**。若用户不同意，允许手动指定。

### 3. 生成项目基 (AGENTS.md)

在项目根目录强制生成 `AGENTS.md`（作为 Layer 3 纯粹项目级约束）。格式如下：

```markdown
# [自动提取的项目名称] 核心开发约束 (Layer 3)

> last_updated: [ISO 8601 时间戳]
> content_hash: [文件内容的 SHA256 前 8 位，用于检测手动篡改]
> domain: [用户确认的领域标识]

## 1. 技术栈底座

- 语言:
- UI框架:
- 状态/网络:

## 2. 核心依赖锁定

- [依赖名]: [锁定版本] (供 Context Loader 依赖收束比对)

## 3. 架构与目录法则

- (提取到的目录规范与分层要求，指明模块间依赖方向)

## 4. 禁止操作 (Project Red Lines)

- (项目级红线，如：禁止直接操作生产数据库、禁止引入新 CSS 框架)

## 5. 质量门禁 (Quality Gates)

- 验证命令: `[真实的测试/Lint命令，例如 npm run test]`
  > 警告：每次 /r-dev 和 /r-review 结束后必须全量运行以上命令。
```

### 4. 路由挂载 (IDE Adapter)

在项目根目录隐式生成或更新 IDE 配置文件。**根据检测到的 IDE 类型自动适配**：

| 检测标志              | 配置文件                                    | 适配器    |
| --------------------- | ------------------------------------------- | --------- |
| `.cursor/` 目录存在   | `.cursorrules`                              | Cursor    |
| `.windsurf/` 目录存在 | `.windsurfrules`                            | Windsurf  |
| `.vscode/` 目录存在   | `.vscode/settings.json` (ritsu 节)          | VSCode    |
| `.idea/` 目录存在     | `.idea/ritsu.xml`                           | JetBrains |
| 无法检测              | 生成 `.cursorrules` + `.windsurfrules` 双份 | 兜底      |

路由内容必须包含：

```text
如果你是一个在当前 IDE 中的 AI：
1. 你的全局基础约束，受 Ritsu 的 rules/ 和 domains/ 目录控制。
2. 本项目的具体业务规则，受根目录 `AGENTS.md` 约束。
3. 技能间流转协议，受 `state-machine.md` 约束。
4. 严格指令前缀路由（看到以下前缀，立即放弃闲聊，直接加载对应能力）：
   - `/r-init` -> 侧重项目基线扫描与约束生成。
   - `/r-think` -> 侧重防腐设计、回滚推演、架构攻击测试。
   - `/r-dev` -> 侧重死抠细节、防编造标识符、零占位符纯净开发。
   - `/r-review` -> 侧重化身安全专家/黑客进行底线拦截。
   - `/r-hunt` -> 侧重悬案诊断、看病查日志，仅允许最小化探针。
   - `/r-triage` -> 侧重冷酷事实驱动的 Issue/PR 分诊与处置。
```

### 5. 增量更新 (Refresh Mode)

当用户执行 `/r-init:refresh` 时：

- 不覆盖 `AGENTS.md`，而是 diff 当前扫描结果与现有 `AGENTS.md` 的差异。
- 仅输出变更点，由用户确认后合并更新。
- 更新 `last_updated` 时间戳和 `content_hash`。

> 初始化完毕后，技能流转参见 `state-machine.md`。
