# Ritsu 决策日志

> **目的**：沉淀重大设计/路线决策——做了什么、为什么、谁拍板、何时
> **维护策略**：每条决策独立条目；不删旧条目，新决策追加在底部；变更原决策时新建条目说明覆盖关系
> **格式**：日期 + 决策摘要 + 上下文 + 备选方案 + 选择理由 + 影响范围

---

## 2026-05-15 · 路线 v2 重排：从生成时刻向外辐射

**决策**：放弃 v1 ROADMAP 的"治理优先"四阶段路线，重排为"生成时刻闭环 → 测试充分性 → 工业级 review → 闭环固化"。
**上下文**：代码摸排发现 v1 路线对北极星"让 AI 写代码可治理可缩放"的覆盖偏向审计端，主动质量层接近空白。
**备选**：保留 v1 路线 + 增量补主动质量层。
**理由**：v1 的 detector 占位符问题已暴露"看上去完整但拦截缺失"——需要根本性重排而不是打补丁。
**影响**：v1 phase-1-implementation.md 归档；新 v2 ROADMAP 取代主文档；产生 [v2-stress-test.md](./v2-stress-test.md) + [v2-execution-priority.md](./v2-execution-priority.md) 配套。
**拍板**：3kaiu

---

## 2026-05-15 · M1 直接覆盖 v1 Phase 1 必做项

**决策**：v2 Phase A M1 直接吃掉 v1 Phase 1 自洽硬指标（版本号 SoT 统一、`runtime/dist/` 退 git、skill 集合三方对齐、AGENTS.md ritsu block 模板化），跳过 v5.3 中间版本，直奔 v5.4。
**上下文**：v1 Phase 1 的 8 条 DoD 中 6 条是自我擦屁股，单独发一版"自洽收敛 release"价值低且强化反指标"Ritsu 自己变复杂"。
**备选**：(a) 先 freeze v5.3 再走新路线；(b) 把 Phase 1 散到各 phase 顺便做。
**理由**：(a) 慢 1-2 个月；(c) 容易遗漏。(b) 把高优自洽工作捆入 v5.4 既快又系统。
**影响**：CHANGELOG 中 v5.3 不存在；v5.4 release notes 含全部自洽收敛项。
**拍板**：3kaiu

---

## 2026-05-15 · 「对抗式补测」新增 /r-augment skill

**决策**：新增独立 `/r-augment` skill 承担对抗式补测，**不复活** `/r-test`。
**上下文**：v1 Phase 1 已决定下线 `/r-test`（合并入 dev/review）；若复活会与 v1 决策直接冲突，且会让贡献者困惑。
**备选**：(b) 撤回 v1 决策复活 `/r-test`；(c) 做成 `/r-dev` P2 子阶段，不增 skill。
**理由**：(b) 制造历史包袱；(c) 增加单一 skill 复杂度，违背"显式阶段"四大支柱原则。(a) 语义清晰、入口独立、便于与 dev 协调。
**影响**：marketplace.json 注册 ritsu-augment；skills/augment/SKILL.md 待建；Phase B B2 任务承接此 skill 的完整实现。
**拍板**：3kaiu

---

## 2026-05-15 · RFC-002 v6.1 scope 选定「中集」

**决策**：v6.1 跨 agent 协作协议范围 = 跨进程传播 + HMAC 签名 + file-lease + coordination-sheet 机器可读 + task claim 协议（~8 周）。
**上下文**：RFC-001 §2.2 / §8 / §10 明言两项推延（跨进程 + 签名），但真实多 agent 协作还需要文件协调、机器可读协调单、任务领取——三选三才能"真协作可执行"。
**备选**：
- 最小集（仅跨进程 + 签名，~4 周）—— 不够实用
- 全集（中集 + 预算 + 能力协商，~14 周）—— 能力协商接近"agent 编排框架"反指标
**理由**：中集是"真多 agent 并行能跑起来的最小粒度"；能力协商/预算等留 v6.2 评估。
**影响**：[RFC-002](./rfc/003-multi-agent-collaboration.md) 起草完成；ROADMAP 加 Phase E；execution-priority 加 Batch 8。
**拍板**：3kaiu

---

## 2026-05-15 · Phase E 后的候选方向决策

**决策**：Phase E 推进期间产生 3 个候选后续方向，决策如下：

| 候选 | 决策 | 备注 |
|---|---|---|
| 给 RFC-002 做一轮压力测试（类似 [v2-stress-test.md](./v2-stress-test.md)） | **暂缓** | RFC-002 设计建立在 RFC-001 已验证基础上 + 明确遗留项，成熟度足够，无需提前压力测试 |
| 把 RFC-002 8 周拆解整合进 [v2-execution-priority.md](./v2-execution-priority.md) 作 Batch 8 | **接受** | 让 execution-priority 成为唯一执行 SoT |
| 起草 RFC-003（v6.2 议题：能力协商 / 预算 / OTel exporter / ed25519 等推延项） | **接受** | 把 RFC-001/002 punt 到 v6.2+ 的所有项整合 |

**上下文**：用户问 "继续 3 → 2"——即先 RFC-003 再 execution-priority 整合。
**影响**：[RFC-003](./rfc/004-advanced-coordination.md) 起草完成；ROADMAP 加 Phase F；execution-priority 同时加 Batch 8 (RFC-002) + Batch 9 (RFC-003)。
**拍板**：3kaiu

---

## 决策模板（追加新条目时复制）

```markdown
## YYYY-MM-DD · {决策一句话摘要}

**决策**：{具体做了什么决定}
**上下文**：{为什么这个问题摆上桌}
**备选**：{评估过的其他方案}
**理由**：{为什么选这个，否决其他}
**影响**：{哪些文档/代码会跟着变}
**拍板**：{决策人}
```
