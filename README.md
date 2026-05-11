# 律 (Ritsu) — AI 交付系统

> **版本**：v3.8.0 · **协议**：MIT

Ritsu 的核心目标不是提供更多 skill，而是把 AI 从“会写代码”推进到“能按工程纪律完成交付”。

当前产品面建议按一个清晰闭环来理解：

1. `intake`：接需求，识别风险和执行路径
2. `deliver`：按任务模式完成实现与验证
3. `assure`：判断是否可合并、可上线、剩余风险是什么

当前仓库里的文件名仍然沿用 `route / pipe / review`，但产品语义上分别对应 `intake / deliver / assure`。

---

## 三步闭环

### 1. Intake

`intake` 负责把自然语言需求转成统一执行单，而不是把用户暴露给过多技能入口。

它要回答四个问题：

- 这是什么类型的任务
- 信息是否充分
- 风险等级是什么
- 下一步该走哪条交付路径

### 2. Deliver

`deliver` 是交付主入口。它内部可以调设计、开发、测试、诊断等能力，但用户不需要理解内部 skill 细节。

`deliver` 只暴露三种模式：

- `quick`：低风险、小改动，直做直验
- `standard`：常规需求，按默认闭环推进
- `critical`：高风险任务，强制做边界、验证和回滚准备

### 3. Assure

`assure` 负责最终验收，不只是“代码审查”。

它必须输出：

- 是否可合并
- 是否可上线
- 阻断项
- 剩余风险
- 回滚条件

---

## Golden Path

第一次使用，先跑最短闭环：

```text
# 1) 初始化项目基线
/r-init

# 2) 受理需求，形成执行路径
/r-route "实现：用户登录态持久化 + 自动续期"

# 3) 推进交付
/r-pipe standard "实现：用户登录态持久化 + 自动续期"

# 4) 产出最终验收结论
/r-review
```

---

## 为什么这样收敛

AI 交付系统最关键的不是功能数量，而是业务闭环质量。

默认 AI 编程流程常见问题：

| 问题 | 表现 | Ritsu 的目标 |
| --- | --- | --- |
| 入口过多 | 用户先花时间选命令 | 收敛成 intake / deliver / assure |
| 治理过重 | 小需求也被重流程拖慢 | 用 quick / standard / critical 分级 |
| 验证过弱 | 看起来完成，实际不可用 | 把验证和验收拉进主链路 |
| 结果不可追溯 | 不知道为什么这么做 | 用统一产物记录执行与验收 |

---

## 产品结构

建议从四层理解 Ritsu：

```text
skills/Ritsu/
├── skills/     # 产品入口 + 内部能力模块
├── runtime/    # MCP 工具执行层
├── _shared/    # 公共协议与产物格式
├── rules/      # 全局底线
└── domains/    # 领域自适应规则
```

### 主入口

- `route`：当前承担 `intake`
- `pipe`：当前承担 `deliver`
- `review`：当前承担 `assure`

### 内部核心能力

- `think`
- `dev`
- `test`
- `hunt`

这些能力仍然重要，但更适合作为 `deliver` 的内部模块，而不是用户的一线入口。

### 内部模式能力

- `refactor`
- `optimize`

这些更适合作为交付模式，而不是独立产品入口。

### 扩展能力

- `init`
- `document`
- `deploy`
- `triage`

这些能力保留，但不属于核心“需求到交付”主链路。

---

## 任务模式

### Quick

适用于：

- 微小变更
- 明确需求
- 低风险范围

特点：

- 少确认
- 快执行
- 仍要保留基本验证

### Standard

适用于：

- 大多数功能开发
- 常规 bug 修复
- 常规补测试和交付

特点：

- 默认主路径
- 有验证、有审查、有交付摘要

### Critical

适用于：

- 架构改动
- 数据迁移
- 上线风险高
- 外部依赖或回滚复杂

特点：

- 强制做边界澄清
- 强制做风险说明
- 强制准备回滚方案

---

## 当前命令映射

在命名尚未完成重构前，建议按下面理解：

| 当前命令 | 产品语义 | 说明 |
| --- | --- | --- |
| `/r-route` | `intake` | 受理需求，判断执行路径 |
| `/r-pipe` | `deliver` | 推进交付主流程 |
| `/r-review` | `assure` | 产出最终验收结论 |

补充命令：

| 当前命令 | 角色 |
| --- | --- |
| `/r-think` | `deliver` 内部设计阶段 |
| `/r-dev` | 核心实现阶段 |
| `/r-test` | 验证与补测阶段 |
| `/r-hunt` | bugfix 诊断阶段 |
| `/r-opt` | 交付模式能力 |
| `/r-refactor` | 交付模式能力 |

---

## 交付产物

Ritsu 后续会逐步统一到三类主产物：

1. 执行单
   - 需求类型
   - 风险等级
   - 执行路径
   - 关键信息缺口

2. 交付单
   - 改了什么
   - 怎么验证
   - 有什么风险
   - 影响范围

3. 验收单
   - 是否可合并
   - 是否可上线
   - 阻断项
   - 回滚条件

当前主链路应优先沉淀为：

- `intake-ticket`：需求受理单
- `delivery-report`：交付回执
- `assurance-report`：验收结论

其中 `handoff / diagnosis / review-stamp` 仍作为兼容层或过程证据保留，但不应继续占据产品主心智。

---

## 运行时

`runtime/` 提供 MCP 工具执行层，负责：

- ctx 读写
- artifact 落盘
- diff / changed-files / exec
- 质量门禁
- 若干高级能力（sandbox / semantic / kg / ts）

这里有一个明确原则：

- 稳定能力进入主链路
- 高级能力先作为增强项
- 不把实验性能力包装成默认承诺

---

## 安装

```bash
npx skills add 3kaiu/Ritsu -a claude-code -g -y
```

也可安装到 Cursor / Windsurf / Codex / Cline：

```bash
npx skills add 3kaiu/Ritsu -a cursor -g -y
npx skills add 3kaiu/Ritsu -a windsurf -g -y
npx skills add 3kaiu/Ritsu -a codex -g -y
npx skills add 3kaiu/Ritsu -a cline -g -y
```

---

## 初始化

接入新项目时先执行：

```text
/r-init
```

它负责：

- 扫描技术栈
- 生成 `AGENTS.md`
- 注入 `.gitignore`
- 为后续交付建立项目基线

---

## 当前状态

这个仓库仍然保留了较重的 skill 粒度和协议层设计。

当前收敛路线已经明确：

1. 先收敛产品面
2. 再修运行时可信度
3. 再收敛协议层和高级能力

也就是说，Ritsu 现在最重要的不是继续加功能，而是把“需求到交付”的主链路变短、变稳、变可验收。
