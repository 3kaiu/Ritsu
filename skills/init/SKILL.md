---
name: init
version: "3.8.0"
description: "Ritsu setup 基线模块。扫描项目、建立 AGENTS.md 和忽略规则，为后续交付提供基础环境。"
when_to_use: "/r-init, 初始化, 初始化项目, 新项目"
total_steps: 6
hard_constraints:
  - id: HC-1
    rule: "不写业务代码，不修改现有业务逻辑文件"
    severity: FATAL
  - id: HC-2
    rule: "AGENTS.md 已存在时，必须识别是否为异构文件，禁止直接粗暴覆盖"
    severity: FATAL
  - id: HC-3
    rule: "所有字段必须填入真实扫描值，无法确认时写“待补充”"
    severity: FATAL
---

# Init: Setup 基线模块 (Project Baseline Setup)

**触发条件**：用户输入 `/r-init`，或仓库尚未建立 Ritsu 基线时调用。

> 该模块属于 setup，不属于默认交付链路。
> 它不直接绑定 `think/dev/test/hunt/review` 的 flow run，但会为后续 flow 提供 `AGENTS.md`、忽略规则和 `.ritsu/` 基础目录。

## 执行流水线

### 1. 寻址与冲突检测

- 执行 `pwd` 确认当前目录
- 检查 `AGENTS.md`：
  - 不存在 → 继续
  - 存在且为 Ritsu 文件 → 提示是否刷新
  - 存在但为异构文件 → 提供无损注入 / 覆盖 / 跳过三种处理方式

### 2. 项目扫描

读取真实文件，建立项目基线：

- 技术栈
- 架构特征
- 质量门禁命令
- 关键目录结构

### 3. 领域与指纹识别

> 引用 `_shared/skill-common-steps.md` Step 1

根据扫描结果识别：

- domain
- tech_fingerprints
- 可选的 rules_overrides

### 4. 生成或注入 AGENTS.md

按前面确认的策略执行：

- 全新生成
- 更新现有 Ritsu 文件
- 无损注入到异构文件

目标是建立项目基线，不是制造新的仓库冲突。

### 5. 忽略规则与本地 IDE 配置

更新 `.gitignore`，保护：

- `.ritsu/`
- `.claude/`
- `.cursor/` / `.cursorrules`
- `.windsurf/` / `.windsurfrules`

必要时生成本地 IDE 路由配置。

### 6. 交付摘要

> 引用 `_shared/skill-common-steps.md` Step 4（skill=init）

写入 ctx：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=init, artifact=AGENTS.md）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=init）
