---
name: init
version: "3.0.0"
description: "Ritsu 初始化协议。扫描项目架构、提取技术栈与规范，生成 AGENTS.md。"
when_to_use: "/r-init, 初始化, 初始化项目, 新项目"
hard_constraints:
  - id: HC-1
    rule: "不写业务代码，不修改任何现有业务文件"
    severity: FATAL
  - id: HC-2
    rule: "AGENTS.md 已存在时，必须识别是否为异构文件，严禁直接覆盖。异构文件必须提供注入、重置、跳过三种选项"
    severity: FATAL
  - id: HC-3
    rule: "所有字段必须填入真实扫描值，发现无法确定的字段填写'待补充'"
    severity: FATAL
---

# Init: 初始化项目约束基线 (Project Foundation)

## ⚡ 执行前必读
| ID | 约束 | 违反后果 |
|----|------|---------|
| HC-1 | 不写业务代码，不改业务文件 | 终止 |
| HC-2 | 覆盖前识别异构并提供选项 | 终止 |
| HC-3 | 禁止在 AGENTS.md 中留空字段 | 终止 |

---

**触发条件**：用户输入 `/r-init` 或指明需要初始化。

## 执行流水线

### 1. 寻址与冲突检测
- 执行 `pwd` 确认当前目录
- 检查 `AGENTS.md` 是否存在：
  - **不存在** → 直接进入步骤 2
  - **存在且包含 `ritsu-version:`** → 确认为旧版 Ritsu 产物，告知用户版本，询问是否覆盖，等待明确回复
  - **存在且不包含 `ritsu-version:`** → 确认为异构配置（其他 AI 或人工生成）
    - ⚠️ **严禁直接覆盖！** 必须向用户报告发现异构文件，并强制提供三个选项：
      1. 【无损注入】：仅在文件顶部追加 Ritsu 必需的 `ritsu-version` 和 `domain` 字段，原内容一字不改（推荐，实现多 AI 共存）
      2. 【强行覆盖】：清除原内容，按 Ritsu v3.0 完全重写
      3. 【跳过】：不修改文件，当前会话每次手动指定 domain
    - 等待用户明确选择（1/2/3）后，再决定后续写入行为

### 2. 深度扫描（真实读取，禁止猜测）
并发执行，将结果直接用于步骤 3 的领域推断：
- **技术栈**：读取 `package.json` / `pom.xml` / `go.mod` / `requirements.txt` / `Cargo.toml`
- **架构模式**：采样 3-5 个核心文件，判断分层结构
- **质量门禁**：读取 `Makefile` / `.github/workflows/` / `package.json scripts`，找不到则填 `待补充`

### 3. 领域解析（结合扫描结果）
> 引用 `_shared/domain-resolver.md`
> 步骤 2 的扫描结果作为 P2 的辅助依据（不覆盖 P1）：
> - package.json + React/Vue → frontend 倾向
> - go.mod / pom.xml（无前端框架）→ backend 倾向
> - .tf / docker-compose → infra 倾向
> - 两类混合 → fullstack 倾向

### 4. 生成 AGENTS.md
根据步骤 1 用户的选择执行不同写入策略：
- **若是全新生成 / 用户选择【强行覆盖】**：
  严格按 `_shared/artifact-schema.md` Schema 0 输出，将步骤 2/3 的扫描值填入。任何无法确定的字段填 `待补充`，不允许留空。调用 `ritsu_write_artifact` 写入全量内容。
- **若是用户选择【无损注入】**：
  在现有的 `AGENTS.md` 最顶部追加 Ritsu Block：
  ```markdown
  <!-- Ritsu Configuration Block -->
  ritsu-version: 3.0.0
  domain: {推断出的领域值}
  <!-- End Ritsu Block -->
  ```
  保留原文件其余部分不变，调用文件写入工具完成无损注入。

### 5. Git 污染防范 (Git History Pollution)
必须防止 Ritsu 产生的对话产物被意外提交。
- 检查项目根目录是否存在 `.gitignore` 文件。
- 如果存在，读取并检查是否已包含 `ritsu/`（忽略整行匹配）。
- 如果未包含或 `.gitignore` 不存在，使用工具自动向 `.gitignore` 文件末尾追加一行 `ritsu/`，并向用户提示已保护 Git 历史。

### 6. IDE 路由挂载
询问用户："请确认当前使用的 IDE（Cursor / Windsurf / 两者都要 / 跳过）？"
- Cursor → 生成 `.cursorrules`
- Windsurf → 生成 `.windsurfrules`
- 两者 → 同时生成
- 跳过 → 不报错，继续

配置内容：
```
Ritsu Bundle v3.0 已激活。
全局规则：~/.gemini/antigravity/skills/Ritsu/
项目规则：AGENTS.md
指令前缀（识别后立即加载对应 SKILL.md）：
  /r-route /r-init /r-think /r-dev /r-review /r-hunt /r-triage
```

### 7. 写入 ctx.md
调用 **`ritsu_write_artifact`**（type=ctx）追加：
```
{timestamp} | init | domain={value} | done | AGENTS.md
```

---

## ⛔ 尾部锚点
**HC-1 最终提醒**：init 完成后，AGENTS.md 是唯一产物，不附带任何业务代码或逻辑变更。

## 关联流转
> 引用 `_shared/state-machine.md` — init 完成引导语。
