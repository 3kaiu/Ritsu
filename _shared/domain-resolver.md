# 领域解析协议 (Domain Resolver)

> Ritsu Bundle 共享协议 v3.3.0 · 所有技能必须引用此文件，禁止各自重复实现领域判断逻辑。

---

## 解析优先级

按以下顺序执行，**首个命中即停止**，并以 `[RITSU_CTX]` 标记输出结果。

### P1 — 读取 AGENTS.md `domain` 字段

```
检查项目根目录 AGENTS.md 是否存在 `domain:` 字段。
若值为以下合法值之一，直接采用：frontend / backend / fullstack / infra / data
```

### P2 — 分析变更文件后缀（工作区 + 暂存区）

```bash
# 同时检查未暂存变更和已暂存变更，合并去重后判断
git diff --name-only
git diff --name-only --cached
```

后缀映射规则：

- `.tsx / .vue / .svelte / .css / .html` → `frontend`
- `.go / .java / .py / .rs / .rb / .php / .sql` → `backend`
- `.tf / .yml（CI） / .dockerfile / .sh` → `infra`
- `.ipynb / .sql（分析型） / .parquet / .dbt` → `data`
- 前两类混合出现 → `fullstack`
- 无任何变更文件（新项目）→ 跳过 P2，进入 P3

### P3 — 强制询问用户（兜底）

```
若 P1/P2 均无法确定，强制输出：
"⚠️ 拦截：请明确本次工作的领域定位？
  可选值：frontend / backend / fullstack / infra / data"
```

---

## 输出规范

解析完成后，**必须在响应顶部输出以下标记行**（技能 downstream 读取时 grep 此标记）：

```
[RITSU_CTX: domain={value}]
```

领域值含义：

| 值          | 含义                                      | 各技能支持                                    |
| ----------- | ----------------------------------------- | --------------------------------------------- |
| `frontend`  | 纯前端：UI 组件、状态管理、样式、路由     | 全技能支持                                    |
| `backend`   | 纯后端：API、数据库、服务端逻辑、消息队列 | 全技能支持                                    |
| `fullstack` | 前后端同时涉及                            | 全技能支持（覆盖双侧检查清单）                |
| `infra`     | DevOps / CI / IaC / 基础设施              | think/dev/review 部分支持，hunt/triage 全支持 |
| `data`      | 数据管道 / 分析 / ML 工程                 | think/dev/review 部分支持，hunt/triage 全支持 |

> ⚠️ 当领域为 `infra` 或 `data` 时，技能中未覆盖该领域的检查清单项应跳过，并在输出中注明"此项不适用于当前领域"，禁止强行套用前端/后端规则。
