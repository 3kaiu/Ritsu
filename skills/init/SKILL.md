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
    rule: "AGENTS.md 已存在时，必须询问用户确认后才能覆盖"
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
| HC-2 | 覆盖 AGENTS.md 前必须用户确认 | 终止 |
| HC-3 | 禁止在 AGENTS.md 中留空字段 | 终止 |

---

**触发条件**：用户输入 `/r-init` 或指明需要初始化。

## 执行流水线

### 1. 寻址与冲突检测
- 执行 `pwd` 确认当前目录
- 检查 `AGENTS.md` 是否存在：
  - 存在 → 读取 `ritsu-version:` 字段，告知用户版本，询问是否覆盖，**等待明确回复**
  - 不存在 → 直接进入步骤 2

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
严格按 `_shared/artifact-schema.md` **Schema 0** 输出，调用 **`ritsu_write_artifact`**（type=ctx，实际写 AGENTS.md）：
- 将步骤 2/3 的扫描值填入所有字段
- 任何无法确定的字段填 `待补充`，不允许留空

### 5. IDE 路由挂载
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

### 6. 写入 ctx.md
调用 **`ritsu_write_artifact`**（type=ctx）追加：
```
{timestamp} | init | domain={value} | done | AGENTS.md
```

---

## ⛔ 尾部锚点
**HC-1 最终提醒**：init 完成后，AGENTS.md 是唯一产物，不附带任何业务代码或逻辑变更。

## 关联流转
> 引用 `_shared/state-machine.md` — init 完成引导语。
