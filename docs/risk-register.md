# Ritsu 风险登记册

> **生成日期**：2026-05-15
> **基准**：Ritsu 全景状态盘点 §7 跨切关注点的展开
> **维护策略**：每季度复审一次；新风险出现时即时登记；已闭环风险移到底部 §3 历史记录
> **严重度定义**：
> - **Critical**：已影响产品对外宣称的核心能力或安全边界
> - **High**：会导致产品在真实使用中失效（拦截缺漏、性能不可用）
> - **Medium**：会增加维护成本或埋下未来债
> - **Low**：当前可接受，需要监测

---

## 1. 当前开放风险（按严重度排序）

| ID | 风险描述 | 类型 | 严重度 | 状态 | 缓解措施 | 关联路线 |
|---|---|---|---|---|---|---|
| **R-05** | policy 引擎自身无单元测试；regex.ts / evaluatePolicies / loader 的合并逻辑全部未覆盖 | 测试空白 | High | 开放 | 补 `runtime/tests/policy/*.test.ts`，至少覆盖 regex / loader merge | （独立项） |
| **R-07** | `ctx-reader.ts` 静默 skip 坏 JSON 行；可能掩盖数据丢失或并发写入撕裂 | 静默失败 | Medium | 开放 | 至少 console.warn 记录跳过行数；可加 `--strict` CLI 选项 | （独立项） |
| **R-08** | `correlation.ts` 无 collision 检测；依赖单调 seq + lock；如果 lock 失败或时钟回拨，可能产生重复 cid | 数据完整性 | Medium | 监测 | 加 cid 重复检测警告；时钟回拨场景写入测试 | （独立项） |
| **R-09** | `miner.ts` 对每个文件调用 `git log -p --since=<ts>`——大仓库（>1k 文件改动）性能可能不可接受 | 性能-规模 | Medium | 监测 | 改为一次 `git log --since=<ts>` 拿全量再按文件分组 | （独立项） |
| **R-15** | MCP 对外工具经 v6.1 收敛后约 **25** 个（目标 ≤23）；`policy_check` 已内部化，`inspect_diff` 合并 diff 双工具 | 复杂度内胀 | Medium | 缓解中 | 季度复审；新增须删/并旧工具；lease 三件套合并留 v6.2 | Claude-first 收敛 |
| **R-16** | `index.ts` 版本一致性 console.warn 不阻塞 server 启动——versioning 错误状态可隐藏运行 | 静默失败 | Low | 开放 | RITSU_STRICT=1 时改 throw；保留默认 warn | （独立项） |
| **R-17** | exec 沙盒虽有三层，但 `getAllowedBinariesForProject` 的白名单根据 tech_fingerprints 动态返回——如果 fingerprint 解析失败，白名单可能过宽 | 安全边界 | Medium | 开放 | 加测试覆盖 fingerprint 缺失/异常时的 fallback 行为 | （独立项） |
| **R-18** | `policy-check` handler 完全没有自动化测试；它是安全敏感入口 | 安全测试空白 | High | 开放 | 与 R-05 一起补 `runtime/tests/handlers/policy-check.test.ts` | （独立项） |

---

## 2. 风险类型分布

```
Critical:  1  ██
High:      5  ██████████
Medium:    6  ████████████
Low:       2  ████
```

**警示**：Critical + High 占 50%；其中 7/9 与"接线/拦截"主题相关。这与历史健康度评估一致——架构与协议成熟，但**生成端→拦截端→验收端的信息链尚未真正闭环**。

---

## 3. 历史已闭环风险

| ID | 风险描述 | 关闭原因 |
|---|---|---|
| **R-01** | `scope-diff.ts` / `cross-file.ts` 占位符问题 | Phase A 已完成真落地 |
| **R-02** | 实拦截率低 (17%) | 已通过 scope/cross-file/contract 落地提升至 33%，且 SoT 机制已建立 |
| **R-03** | `ritsu-augment` ghost 引用 | skills/augment/SKILL.md 已创建，逻辑已落地 |
| **R-10** | review 阶段信息断链 | Phase C 已强制执行三方证据对账 |
| **R-11** | dev 阶段 quality_gates 强制度不足 | Phase A 已升级 SKILL 约束与字段强制 |
| **R-12** | preferences schema 无人消费 | Phase A 已实现 preference_lint detector |
| **R-13** | `runtime/dist/` 追踪问题 | 已通过 `git rm --cached` 并更新 .gitignore 解决 |
| **R-14** | 全局版本漂移 | 已通过 `sync-version.js` 实现全局 v5.6.0 统一 |
| **R-04** | `output_schema` 强制化 | 已通过 `RITSU_STRICT_OUTPUT` 默认开启机制闭环 |
| **R-06** | Policy 加载性能 | 已通过 mtime-based 缓存机制闭环 |

---

## 4. 复审节奏

- **每月**：对 Critical / High 状态变更进行 standup-level 复查
- **每季度**：对所有 Open 风险进行严重度重评 + 移入历史
- **每 Phase 完成时**：必须把该 Phase 关联的风险全部 close 或显式延后
