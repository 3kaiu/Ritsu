# 律 (Ritsu)

Ritsu 不是“更多 skill 的集合”，而是一套把 AI 交付流程收敛成可执行闭环的工程协议。

如果你只想先用起来，记住这一句就够了：

`/r-init -> /r-route -> /r-pipe -> /r-review`

---

## 先说怎么用

### 1. 安装

```bash
npx skills add 3kaiu/Ritsu -a claude-code -g -y
```

也支持：

```bash
npx skills add 3kaiu/Ritsu -a cursor -g -y
npx skills add 3kaiu/Ritsu -a windsurf -g -y
npx skills add 3kaiu/Ritsu -a codex -g -y
npx skills add 3kaiu/Ritsu -a cline -g -y
```

### 2. 初始化项目

在新仓库里先执行：

```text
/r-init
```

它会建立 Ritsu 的项目基线，包括：

- 扫描技术栈
- 生成 `AGENTS.md`
- 注入必要忽略规则
- 为后续交付准备上下文与产物目录

### 3. 跑一轮最短闭环

```text
/r-route "实现：用户登录态持久化 + 自动续期"
/r-pipe standard "实现：用户登录态持久化 + 自动续期"
/r-review
```

如果需求很小，也可以直接：

```text
/r-pipe quick "修复登录页按钮禁用状态错误"
/r-review --fast
```

---

## 你真正需要记住的命令

对大多数人来说，日常只需要 4 个主命令，外加 2 个补充命令。

| 命令 | 什么时候用 | 结果 |
| --- | --- | --- |
| `/r-init` | 第一次接入项目 | 建立项目基线 |
| `/r-route` | 不确定从哪开始，或需求还不清晰 | 生成 intake 执行单，给出路径和风险等级 |
| `/r-pipe` | 要开始真正交付 | 按 quick / standard / critical 推进实现与验证 |
| `/r-review` | 要最终判断能不能合并、能不能上线 | 输出 assurance 结论 |
| `/r-read` | 你只想读代码、理解逻辑、不改东西 | 只读分析 |
| `/r-deploy` | 真的要部署或发布 | 基于 assurance 结论执行上线动作 |

结论很直接：

- 不确定时，用 `/r-route`
- 要干活时，用 `/r-pipe`
- 要收口时，用 `/r-review`
- 只看不改时，用 `/r-read`

---

## 什么时候不要自己选内部 skill

这是目前最容易把人绕晕的地方。

`think / dev / test / hunt / optimize / refactor` 这些 skill 仍然存在，但它们更适合被 `deliver` 内部调用，而不是让用户先判断该点哪一个。

默认原则：

- 用户入口优先：`route / pipe / review`
- 内部能力后置：`think / dev / test / hunt`
- 扩展动作单列：`read / deploy / document / triage`

换句话说：

- 你不是在“选择 skill”
- 你是在“选择当前处于受理、交付、还是验收阶段”

---

## 一张图看懂主流程

```text
用户需求
  ↓
/r-route
  ↓
intake-ticket
  ↓
/r-pipe (quick | standard | critical)
  ↓
delivery-plan   [按需要产出]
delivery-report
  ↓
/r-review
  ↓
assurance-report
release-advice  [涉及发布判断时产出]
```

这是 Ritsu 当前唯一应该优先理解的主链路。

---

## 三个主阶段

### 1. Route = Intake

`/r-route` 负责把自然语言需求变成可以执行的受理单。

它主要回答：

- 这是什么任务
- 风险高不高
- 信息够不够
- 下一步走什么路径

常见输出是：

- `deliver.quick`
- `deliver.standard`
- `deliver.critical`
- `assure`
- 某个扩展模块

### 2. Pipe = Deliver

`/r-pipe` 是真正的交付主入口。

它内部可能会用到：

- `think`：补边界、补契约
- `dev`：实现改动
- `test`：补测试、做验证
- `hunt`：定位故障、恢复交付

但这些通常不需要用户手动调度。

Ritsu 对外只暴露 3 种交付模式：

| 模式 | 适用场景 |
| --- | --- |
| `quick` | 小改动、低风险、需求明确 |
| `standard` | 常规功能、常规 bugfix |
| `critical` | 架构改动、迁移、高发布风险 |

### 3. Review = Assure

`/r-review` 不是普通代码 review，而是最终验收关口。

它要明确给出：

- 是否可合并
- 是否可上线
- 阻断项是什么
- 剩余风险是什么
- 下一步建议是什么

如果涉及明确发布姿态，它还会产出 `release-advice`。

---

## 我到底该怎么选模式

### Quick

用于：

- 改动很小
- 风险很低
- 验收标准明确

例子：

- 修一个 UI 显示错误
- 修一段文案逻辑
- 补一个很明确的判空

### Standard

默认选这个。

用于：

- 正常功能开发
- 常规 bug 修复
- 需要补测试或做完整验证

例子：

- 新增登录态续期
- 修复接口状态同步问题
- 调整表单提交流程

### Critical

用于：

- 数据迁移
- 核心流程改造
- 高风险发布
- 回滚复杂

例子：

- 改鉴权链路
- 调整计费流程
- 重构状态管理主干

---

## 主产物只有五类

现在主链路统一收敛为五类主产物：

| 类型 | 作用 |
| --- | --- |
| `intake-ticket` | 记录需求理解、风险分级、执行路径 |
| `delivery-plan` | 记录实施目标、范围、步骤、验证计划、回滚说明 |
| `delivery-report` | 记录实际交付结果与风险 |
| `assurance-report` | 记录最终验收结论 |
| `release-advice` | 记录发布方式、灰度建议、回滚条件、业务影响 |

这五类之外的产物不是没用，而是地位不同：

| 类型 | 角色 |
| --- | --- |
| `handoff` | 设计/契约细化证据 |
| `diagnosis` | 故障定位证据 |
| `review-stamp` | 兼容镜像 |
| `optimize-report` | 优化类过程证据 |

默认读取顺序也应当是：

1. `primary`
2. `evidence`
3. `compatibility`

更多解释见 [_shared/artifact-layers.md](/Users/edy/CascadeProjects/Ritsu/_shared/artifact-layers.md:1)。

---

## Skill 冗余问题，结论是什么

结论是：**有一些“入口级冗余”还存在，但大部分不是能力冗余，而是暴露层级冗余。**

更具体地说：

### 真正应该让用户直接感知的

- `init`
- `route`
- `pipe`
- `review`
- `read`
- `deploy`

### 更适合作为内部能力的

- `think`
- `dev`
- `test`
- `hunt`

### 更适合作为交付模式而不是单独入口的

- `optimize`
- `refactor`

### 保留为扩展模块的

- `document`
- `triage`

所以“skill 还多不多”的答案是：

- 从仓库结构看，还是多
- 从产品入口看，已经应该收敛到很少

当前真正的问题不是必须立刻删文件，而是：

- README 没把“主入口”和“内部能力”分开讲清楚
- 用户还会误以为自己要在 `think/dev/test/hunt` 之间做路由决策

这次 README 重写，核心就是把这层误解拆掉。

---

## 如果你只做一种用法

最稳的默认方式就是：

```text
/r-route "描述任务"
/r-pipe standard "描述任务"
/r-review
```

除非你非常明确：

- 只是读代码：`/r-read`
- 只是发布：`/r-deploy`
- 已知是极小改动：`/r-pipe quick`

其余 skill 不必先碰。

---

## 仓库结构

```text
Ritsu/
├── skills/     # 兼容入口、内部能力、扩展模块
├── runtime/    # MCP 工具执行层
├── _shared/    # 公共协议、schema、模板、产物定义
├── rules/      # 全局底线
└── domains/    # 领域规则
```

你可以这样理解：

- `skills/` 决定“流程怎么走”
- `runtime/` 决定“工具怎么执行”
- `_shared/` 决定“大家说同一种协议”

---

## Runtime 在做什么

`runtime/` 提供 MCP 工具层，负责：

- ctx 读写
- artifact 写入和列出
- diff / changed-files / exec
- 质量门禁
- semantic / kg / sandbox / ts 等增强能力

设计原则是：

- 稳定能力进入主链路
- 增强能力按需启用
- 实验能力不包装成默认承诺

---

## 当前推荐理解

如果你读完整个仓库后只带走 4 个判断，这就够了：

1. 主入口是 `route / pipe / review`
2. 主产物是五类：`intake-ticket / delivery-plan / delivery-report / assurance-report / release-advice`
3. `think / dev / test / hunt` 主要是 `deliver` 的内部能力，不是默认用户入口
4. `read` 和 `deploy` 是少数值得单独保留的一线补充命令

这也是 Ritsu 现在的收敛方向：不是再加 skill，而是把“需求到交付”的闭环变短、变稳、变清楚。
