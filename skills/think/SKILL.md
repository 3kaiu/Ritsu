---
name: think
version: "3.0.0"
description: "Ritsu 领域自适应需求评审与架构设计。强制拆分为评审阶段和设计阶段，输出防腐 Handoff 文件。"
when_to_use: "/r-think, 设计方案, 怎么做, 要不要做, 分析一下, 看看这个 PRD"
hard_constraints:
  - id: HC-1
    rule: "Phase A 完成后必须强制停止，收到用户确认后才进入 Phase B"
    severity: FATAL
  - id: HC-2
    rule: "Handoff 文件不得包含 TODO/待定/暂不处理 等占位符"
    severity: FATAL
  - id: HC-3
    rule: "文件名必须使用 kebab-slug 规则，不得使用中文或空格"
    severity: WARN
---

# Think: 领域自适应需求评审与架构设计

## ⚡ 执行前必读
| ID | 约束 | 违反后果 |
|----|------|---------|
| HC-1 | Phase A 后强制停止等待确认 | 终止，回退到 Phase A |
| HC-2 | Handoff 无占位符 | 拒绝写入文件 |
| HC-3 | 文件名 kebab-slug | 警告并修正 |

---

**触发条件**：用户输入 `/r-think`。

## Phase A — 需求评审会

### A1. 领域解析
> 引用 `_shared/domain-resolver.md`，输出 `[RITSU_CTX: domain={value}]`

写入 ctx.md（调用 **`ritsu_write_artifact`** type=ctx）：
```
{timestamp} | think | domain={value} | started | none
```

### A2. 多维轰炸（基于领域）

**backend**：并发量？写入幂等？缓存击穿防御？事务回滚方案？审计日志要求？

**frontend**：弱网/断网兜底视图？空数据/超长文本极端 UI？401/403/500 各自跳出策略？

**fullstack**（在前后端问题基础上追加）：
- BFF 层是否必要？前后端数据格式是否存在阻抗失配？
- SSR/CSR/ISR 选择依据？SEO 要求如何影响渲染策略？
- 统一鉴权链路设计？前端 Token 失效与后端 Session 过期如何同步？

**infra**：变更幂等？tfstate 损坏恢复方案？IAM 最小权限审查？

**data**：数据血缘可追溯？上游变更通知机制？重跑策略幂等性？

### A3. 输出漏洞清单并强制停止
```markdown
## ⚠️ 需求漏洞清单 (Phase A)
| # | 漏洞 | 风险 | 建议处理 |
|---|------|------|---------|
| 1 | ...  | 高   | ...     |
---
**收到你的逐条确认后，进入 Phase B（架构设计）。**
```

**收到确认前，保持等待，重复上方提示，不进入 Phase B。**

---

## Phase B — 架构设计与 Handoff 输出

### B1. 契约优先
先锁定边界契约（引用 `_shared/artifact-schema.md` Schema 1 Contract 字段），再构思实现逻辑。

### B2. 多方案博弈
提供 2 套方案，使用强制对比表格：
| 维度 | 方案 A | 方案 B |
|------|-------|-------|
| 核心依赖 | | |
| 实现复杂度（1-5）| | |
| 运维成本 | | |
| 可扩展性 | | |
| 推荐原因 | | |

首推方案必须通过三项攻击测试：
1. **宕机**：外部依赖 502 时的降级方案（不接受"暂无"）
2. **10x**：流量放大 10 倍最先撑爆的点及缓解措施
3. **回滚**：逐步骤列出回滚指令 + 脏数据恢复方案

### B3. Handoff 文件输出
命名规则：需求描述前 3 个有效英文关键词 → kebab-case（如 `handoff-user-login-flow.md`）

调用 **`ritsu_write_artifact`**（type=handoff）写入，Schema 引用 `_shared/artifact-schema.md` Schema 1。

写入完成后更新 ctx.md：
```
{timestamp} | think | domain={value} | done | ritsu/handoff-{slug}.md
```

---

## ⛔ 尾部锚点
**HC-1 最终提醒**：Handoff 文件写入前，调用 `ritsu_write_artifact` 的内置校验会拦截任何占位符，写入成功即为合规交付。

## 关联流转
> 引用 `_shared/state-machine.md` — think 完成引导语。
