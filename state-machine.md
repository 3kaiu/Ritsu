# Ritsu State Machine: 技能流转协议

> version: 2.0.0

## 状态定义

| 状态 | 含义 | 前置条件 | 持久化标记 |
|---|---|---|---|
| `VOID` | 未初始化 | 无 AGENTS.md | 无 |
| `INITED` | 项目基线已建立 | AGENTS.md 存在且有效 | AGENTS.md 存在 |
| `DESIGNED` | 架构设计已产出 Handoff | HANDOFF.md 存在 | HANDOFF.md 存在 |
| `IMPLEMENTED` | 代码已落盘且校验通过 | Lint + Test 全绿 | git tag `ritsu-implemented` |
| `REVIEWED` | 对抗审查通过 | 无 Hard Stop 命中 | git tag `ritsu-reviewed` |
| `DIAGNOSED` | 根因已锁定 | DIAGNOSIS.md 存在且 status=open | DIAGNOSIS.md 存在 |
| `TRIAGED` | Issue/PR 已分诊处置 | TRIAGE.md 存在 | TRIAGE.md 存在 |

> **状态推断规则**：AI 每次启动时，按以下优先级推断当前状态：
> 1. 检查 git tag `ritsu-reviewed` → REVIEWED
> 2. 检查 git tag `ritsu-implemented` → IMPLEMENTED
> 3. 检查 HANDOFF.md 是否存在 → DESIGNED
> 4. 检查 AGENTS.md 是否存在 → INITED
> 5. 以上均无 → VOID

## 合法流转边

```
# 主线 (Happy Path)
VOID ──[init]──→ INITED
INITED ──[think]──→ DESIGNED
INITED ──[dev]──→ IMPLEMENTED          (fast-path: 简单修复可跳过 think)
DESIGNED ──[dev]──→ IMPLEMENTED
IMPLEMENTED ──[review]──→ REVIEWED
REVIEWED ──[triage]──→ TRIAGED

# 回退边 (打回路径)
REVIEWED ──[review:reject:design]──→ DESIGNED        (设计缺陷，回退到 think)
REVIEWED ──[review:reject:impl]──→ IMPLEMENTED       (代码缺陷，回退到 dev)

# 诊断路径 (任意状态可进入)
* ──[hunt]──→ DIAGNOSED
DIAGNOSED ──[dev]──→ IMPLEMENTED                    (简单修复)
DIAGNOSED ──[think]──→ DESIGNED                     (架构级问题)
IMPLEMENTED ──[hunt:verify]──→ DIAGNOSED            (修复后验证根因是否消除)

# 分诊路径
TRIAGED ──[hunt]──→ DIAGNOSED                       (Bug Issue)
TRIAGED ──[think]──→ DESIGNED                       (Feature Issue)
TRIAGED ──[init]──→ INITED                          (新项目 Issue)

# 快速路径 (紧急修复)
TRIAGED ──[dev]──→ IMPLEMENTED                      (P0/P1 快速修复，跳过 think)
DIAGNOSED ──[dev]──→ IMPLEMENTED ──[review]──→ REVIEWED  (诊断后快速闭环)

# 增量更新
INITED ──[init:refresh]──→ INITED                   (项目迭代后刷新基线)

# 闭环验证
IMPLEMENTED ──[triage:verify]──→ TRIAGED             (修复后回到分诊验证 Issue 是否关闭)
```

## 跳步拦截

当用户尝试执行一个技能但其前置条件未满足时：
- **不硬性阻止**（用户可能有合理理由），但**必须发出警告**
- 警告格式：`⚠️ 流转拦截：当前状态为 [X]，执行 [Y] 的前置条件 [Z] 未满足。继续执行可能导致 [具体风险]。确认继续？`
- **P0 豁免**：当用户明确声明是 P0 紧急修复时，跳步警告降级为提示，不阻塞。

## 数据传递契约

技能间传递的数据必须以结构化文件形式存在，禁止纯靠自然语言：

| 产出 | 文件 | 版本管理 | 消费者 |
|---|---|---|---|
| 项目基线 | `AGENTS.md` | `last_updated` + 内容 hash | 所有技能 (via Context Loader) |
| 架构设计 | `HANDOFF.md` | 顶部 `version: N`，每次 think 递增 | dev, review |
| 诊断报告 | `DIAGNOSIS.md` | `status: open/closed`，修复后改 closed | dev, think, hunt:verify |
| 分诊结论 | `TRIAGE.md` | `priority: P0-P4` | hunt, think, init, triage:verify |

> **版本冲突解决**：当 HANDOFF.md version 与 dev 实际使用的版本不一致时，以最新版本为准，并在 dev 交付模板中标注版本号。
