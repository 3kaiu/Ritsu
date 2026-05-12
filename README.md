# 律 (Ritsu)

Ritsu 是一套面向工程交付的 AI 工作流，不再把“编排层”放在用户前面。

当前运行时已经开始把主链路固化成**交付流程系统**：

- 显式 flow manifests：`_shared/flows/*.yaml`
- 流程状态记录：`.ritsu/flows/*.json`
- 脚本优先执行：`ritsu_list_flows / ritsu_run_flow / ritsu_resume_flow / ritsu_get_flow_state / ritsu_apply_flow_decision`

从现在开始，Ritsu 的主使用逻辑只有这一条：

```text
/r-init -> /r-think -> /r-dev -> /r-test or /r-hunt -> /r-review
```

这条链路的目标很明确：

- `think` 负责需求审核、边界澄清、实现判断
- `dev` 负责实现主任务
- `test` 负责验证与补测
- `hunt` 负责定位故障与恢复交付
- `review` 负责最终验收

你看到的 skill，就是 AI 当前所处的工作阶段。默认不再让用户面对黑盒编排入口。

---

## 快速开始

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

```text
/r-init
```

它会建立项目基线：

- 扫描技术栈
- 生成 `AGENTS.md`
- 注入必要忽略规则
- 准备 `.ritsu/` 下的上下文与产物目录

### 3. 跑一轮完整闭环

```text
/r-think "实现：用户登录态持久化 + 自动续期"
/r-dev "按已确认范围完成实现"
/r-test
/r-review
```

如果是报错排障链路：

```text
/r-think "分析登录态为什么会随机失效"
/r-hunt
/r-dev
/r-test
/r-review
```

---

## 你真正需要记住的命令

| 命令 | 什么时候用 | 你会得到什么 |
| --- | --- | --- |
| `/r-init` | 第一次接入项目 | 项目基线 |
| `/r-think` | 需求审核、范围澄清、方案判断 | 审核结论、边界、契约、实施清单 |
| `/r-dev` | 开始实现 | 代码改动、局部验证、交付回执 |
| `/r-test` | 补测试、跑验证、确认覆盖 | 测试结果与验证摘要 |
| `/r-hunt` | 报错、失败、难以定位的问题 | 根因、证据、修复方向 |
| `/r-review` | 最终验收 | 是否可合并、是否可上线、剩余风险 |
| `/r-read` | 只读理解代码 | 阅读摘要 |
| `/r-deploy` | 真的要部署 | 发布动作与冒烟验证 |

一句话判断：

- 不确定该怎么做，用 `/r-think`
- 要开始动手，用 `/r-dev`
- 要验证，用 `/r-test`
- 出问题了，用 `/r-hunt`
- 要收口，用 `/r-review`

---

## 主流程，不再黑盒

```text
需求 / 问题
   ↓
/r-think
   ↓
边界 / 风险 / 契约 / 实施清单
   ↓
/r-dev
   ↓
代码与交付回执
   ↓
/r-test   或   /r-hunt
   ↓
验证通过 / 根因确认
   ↓
/r-review
   ↓
验收结论 / 发布建议
```

这套设计和之前最大的区别是：

- 你不再需要猜 AI 在黑盒里做了什么
- skill 名称就是当前动作
- 阶段切换是显式的，不是编排器代你隐藏

---

## 每个主 skill 的角色

### `think`

`think` 是正式的一线入口，不是隐藏在别的编排层后面的内部模块。

它负责：

- 审核需求是否清楚
- 识别风险等级
- 确定边界和不做项
- 给出契约、验收标准和实施清单

适合场景：

- 新需求刚进来
- 需求描述不完整
- 想先判断值不值得做、该怎么做
- 验收失败后需要重新定边界

### `dev`

`dev` 是正式的实现主入口。

它负责：

- 按边界实现代码
- 校验标识符与签名
- 执行最小必要验证
- 写出交付回执

适合场景：

- 已经知道要改什么
- 需要推进功能开发或 bugfix
- 需要在既定边界内完成交付

### `test`

`test` 是正式的验证入口。

它负责：

- 编写或补齐测试
- 执行验证
- 对齐交付目标、风险和回滚要求

适合场景：

- 需要补单测 / 集成测试
- 需要确认质量门禁
- 想把“看起来完成”变成“可验证完成”

### `hunt`

`hunt` 是正式的诊断入口。

它负责：

- 收集证据
- 提出可验证假设
- 锁定根因
- 决定回到 `dev` 还是回到 `think`

适合场景：

- 报错定位不清楚
- 验证失败但原因不明
- 需要先查清再修

### `review`

`review` 是正式的最终验收入口。

它负责：

- 判断是否可合并
- 判断是否可上线
- 给出阻断项和剩余风险
- 给出建议动作

它不是普通 code review，而是交付闭环的最后一道门。

---

## 默认工作流

### 需求开发链路

```text
/r-think
/r-dev
/r-test
/r-review
```

### 排障修复链路

```text
/r-think
/r-hunt
/r-dev
/r-test
/r-review
```

### 小改动快路径

```text
/r-think --fast
/r-dev --hotfix
/r-test --fast
/r-review --fast
```

这里的 `--fast` 和 `--hotfix` 只是降低交互成本，不等于跳过验证。

## Flow Runtime 怎么介入

默认主链路现在既有显式 skill，也有对应的内建 flow 骨架：

| Skill | Built-in Flow | 作用 |
| --- | --- | --- |
| `think` | `think-clarify` | 恢复上下文、完成澄清、沉淀 `think-ticket / think-plan` |
| `dev` | `dev-delivery` | 对账变更、推进实现、沉淀 `dev-report` |
| `test` | `test-verify` | 运行质量门禁并决定回流方向 |
| `hunt` | `hunt-recovery` | 固化取证、假设、诊断恢复路径 |
| `review` | `review-acceptance` | 汇总交付证据并输出最终验收结论 |

这些 flow 的定位很克制：

- 确定性步骤交给 runtime
- 恢复点写进 `.ritsu/flows/*.json`
- AI 只处理判断位，而不是每次重组整条流程

一个完整恢复链路现在应按这个顺序理解：

1. `ritsu_run_flow` 建立 flow state，并在首个 `ai_decision` 前停住
2. `ritsu_get_flow_state` 或 `ritsu_resume_flow` 用于找回断点
3. `ritsu_apply_flow_decision` 用于提交当前判断位，并可选同时写入该步骤声明的 artifacts
4. runtime 继续推进到下一个 `ai_decision`、失败恢复点或完成态

同一条 flow run 会复用同一个 `correlation_id`，因此 `.ritsu/flows/*.json` 和 `.ritsu/ctx-*.jsonl` 可以按同一任务链路对账。
此外，`ai_decision` 步骤现在可以声明自己的 decision contract。调用 `ritsu_apply_flow_decision` 时，`decision_output` 和关联 artifacts 必须满足该 step 的最小字段要求。
这份 contract 现在还可以进一步约束 artifact 内容锚点，例如某个 `think-ticket` 必须包含指定的推荐路径或验证语句。

扩展技能如 `read / document / deploy / optimize / refactor / triage / init` 不会替代主链路，只是围绕交付闭环提供辅助动作。

---

## 主产物有五类

对外工作流已经切到显式 skill，`.ritsu/` 主产物现在推荐使用显式命名；旧名仍兼容可读可写：

| 类型 | 作用 |
| --- | --- |
| `think-ticket`（兼容旧名 `intake-ticket`） | 记录需求理解、风险分级、执行路径 |
| `think-plan`（兼容旧名 `delivery-plan`） | 记录实施目标、范围、步骤、验证计划、回滚说明 |
| `dev-report`（兼容旧名 `delivery-report`） | 记录实际交付结果与风险 |
| `review-report`（兼容旧名 `assurance-report`） | 记录最终验收结论 |
| `review-advice`（兼容旧名 `release-advice`） | 记录发布方式、灰度建议、回滚条件、业务影响 |

这里要明确一件事：

- 这些是 **持久化格式**
- 括号内是兼容旧名
- 不是要求你继续按 `route / pipe / assure` 那套黑盒阶段去理解系统

你在日常使用里仍然只需要关心：

- `think`
- `dev`
- `test`
- `hunt`
- `review`

---

## 辅助 skill 的定位

这些 skill 保留，但不是默认交付链路：

| skill | 定位 |
| --- | --- |
| `read` | 只读理解代码 |
| `deploy` | 在验收之后执行发布 |
| `document` | 更新 README、API 文档、CHANGELOG |
| `triage` | 处理 issue / PR / 工单流转 |

下面这些不是一线产品入口，而是专项模式能力：

| skill | 定位 |
| --- | --- |
| `optimize` | 减法优化 / 等价替换 |
| `refactor` | 保持行为不变的结构改善 |

---

## 为什么要这样改

旧的编排型入口会有一个根本问题：

- 你知道系统在“交付”
- 但你不知道它现在是在审需求、写代码、补测试、还是排障

这会导致两个实际问题：

1. 用户判断成本高  
   因为入口是抽象的，动作是不透明的。

2. AI 行为像黑盒  
   因为你看到的是“编排状态”，不是“当前技能动作”。

现在这套模型反过来做：

- skill 名就是动作
- 阶段切换显式可见
- 用户可以直接决定走 `think`、`dev`、`test`、`hunt`、`review`

这不是功能变少，而是控制感变强。

---

## 仓库结构

```text
Ritsu/
├── skills/     # 用户入口、专项模式、扩展模块
├── runtime/    # MCP 工具执行层
├── _shared/    # 公共协议、schema、模板、产物定义
├── rules/      # 全局底线
└── domains/    # 领域规则
```

你可以这样理解：

- `skills/` 决定 AI 以什么工作动作与你协作
- `runtime/` 决定工具怎样执行
- `_shared/` 决定整个系统怎样保持同一套协议

---

## Runtime 在做什么

`runtime/` 提供 MCP 工具层，负责：

- ctx 读写
- artifact 写入和列出
- diff / changed-files / exec
- 质量门禁
- semantic / KG / sandbox / TS 等增强能力

设计原则不变：

- 稳定能力进入默认交付链路
- 增强能力按需启用
- 实验能力不包装成默认承诺

---

## 现在的推荐理解

如果你读完整个仓库后只带走 5 个判断，这就够了：

1. 正式主入口是 `think / dev / test / hunt / review`
2. `read / deploy / document / triage` 是辅助入口
3. `optimize / refactor` 是专项模式，不是一线入口
4. 五类主产物只是持久化格式，不是新的黑盒阶段模型
5. Ritsu 的目标是让 AI 的动作更白盒，而不是把更多编排层塞到用户前面

这也是当前版本真正的收敛方向：不是再加 skill，而是让你始终知道 AI 正在做哪一种工程动作。
