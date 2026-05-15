# RFC-002: Cross-Agent Collaboration Protocol

| | |
| --- | --- |
| **Status** | Draft |
| **Author** | 3kaiu |
| **Created** | 2026-05-15 |
| **Target Version** | v6.1.0 |
| **Builds On** | [RFC-001](./001-multi-agent-trace.md) v6.0.0 |
| **Phase** | Phase E (Post v6.0, ~8 weeks) |

---

## 1. 背景与动机

### 1.1 RFC-001 已经给了什么

[RFC-001](./001-multi-agent-trace.md) 在 v6.0 落地了：
- `trace_id` / `span_id` / `parent_span_id` 标识符
- `agent.{id, role, session_id}` 描述事件作者
- `ritsu_open_span` / `close_span` / `join_trace` 三件套
- `coordination-sheet` 产物（人类可读 Markdown）
- v5.x `correlation_id` 向后兼容

**这一层解决的是"事件可以归属、调用树可以重建"。**

### 1.2 RFC-001 明言推延到 v6.1 的事

| 来源 | 内容 | RFC-001 原文 |
| --- | --- | --- |
| §2.2 | 跨进程 trace 传播 | "第一版只支持单机内的 trace；跨进程留待 v6.1" |
| §8 | Agent 身份信任 / span 签名 | "v6.1 引入 span 签名" |
| §10 Q2 | agent.id 白名单防伪 | "v6.0 不做；v6.1 引入 signing key" |
| §10 Q3 | 跨进程传播协议形态 | "用 RITSU_TRACE_PARENT 环境变量传 trace_id:span_id"（Tentative） |

### 1.3 RFC-001 没说但实际多 agent 协作必经的关

实战中如果两个 executor agent 并发跑 dev 阶段，RFC-001 协议层够用——他们各自开 span 不互相覆盖。但**到了真正动手编辑文件、领取任务时**，下面三个空白会立刻浮现：

1. **文件冲突**：两个 agent 同时改 `src/auth/login.ts`，proper-lockfile 只保证 `ctx-*.jsonl` 不撕裂，**源码文件没有协调机制**
2. **协调单的可执行性**：`coordination-sheet` 现在是 Markdown 表格，"executor-A 做前端 / executor-B 做后端"靠 agent 读懂自然语言来执行——这违背 Ritsu "可机器执行" 的核心原则
3. **任务分发的无 API**：planner 写出 coordination-sheet 后，executor agent 如何"领任务"？目前靠 LLM 解析 Markdown 推断——脆弱、不可重放

### 1.4 v6.1 thesis

**Ritsu v6.1 从"多 agent 表达能力"升级为"多 agent 可执行能力"。** 把 RFC-001 的"事件账本"提升为协作的"调度基底"。

---

## 2. 设计目标

### 2.1 必须达成

1. **跨进程 trace 传播**：CLI 调用 CLI、CI 启动子 agent、subagent 嵌套调用都能自动串联 trace
2. **Span 事件签名**：每条事件可被 HMAC 验证来源，伪造事件可被检测
3. **File lease 协调**：并行 agent 抢同一文件时有明确的 claim/release/conflict 协议
4. **coordination-sheet 机器可读**：YAML frontmatter 含结构化 `task_assignments[]`
5. **任务 claim 协议**：`ritsu_claim_task` / `complete_task` 形成可重放的领取-完成闭环

### 2.2 显式非目标

- ❌ **不引入网络传输协议**：仍是单机 + git-native，不做 RPC / WebSocket
- ❌ **不做 OAuth / 用户身份**：agent 信任是项目级 HMAC，不是组织级 IAM
- ❌ **不做 agent 编排框架**：让 LangGraph / Mastra 做调度；Ritsu 只提供协作底层
- ❌ **不做能力协商**（capability negotiation）：v6.2+ 评估
- ❌ **不做预算/计费跟踪**：v6.2+ 评估
- ❌ **不做完整 OTel exporter**：保留格式兼容，导出推到独立 RFC

---

## 3. 协议规范

### 3.1 跨进程 Trace 传播

#### 3.1.1 环境变量约定

灵感来自 W3C Trace Context 的 `TRACEPARENT`，但用 Ritsu 自己的格式：

```
RITSU_TRACE_PARENT=trace-20260515-a3f9c4b8e1d27f06:span-3f9c4b8e:01
```

| 字段 | 长度 | 说明 |
|---|---|---|
| trace_id | 32 hex chars (含前缀) | 沿用 RFC-001 §3.1 |
| span_id | 16 hex chars (含前缀) | 沿用 RFC-001 §3.1，作为 **parent span** |
| flags | 2 hex chars | 预留位，v6.1 仅定义 `01` = sampled |

#### 3.1.2 行为

| 场景 | 行为 |
|---|---|
| 子进程启动时 ENV 含 RITSU_TRACE_PARENT | `ritsu_open_span` 自动将其作为 parent_span_id，新 span 加入既有 trace |
| 子进程启动时 ENV 不含 | 沿用 RFC-001：新建 root span 与新 trace_id |
| 用户显式 `ritsu trace --inject` | 输出 `export RITSU_TRACE_PARENT=...`，供 shell `eval` |

#### 3.1.3 新 handler

```typescript
// 当前会话 → ENV 字符串
ritsu_inject_trace_context(params: {
  span_id?: string;   // 默认当前最新 open span
}): Promise<{
  env_string: string;  // "RITSU_TRACE_PARENT=trace-...:span-...:01"
  trace_id: string;
  span_id: string;
}>

// ENV 字符串 → 设置当前会话上下文
ritsu_extract_trace_context(params: {
  env_value: string;  // "trace-...:span-...:01"
}): Promise<{
  trace_id: string;
  parent_span_id: string;
  flags: number;
}>
```

#### 3.1.4 集成点

- `ritsu_open_span`：启动时检查 `process.env.RITSU_TRACE_PARENT`，未传 trace_id/parent_span_id 时自动注入
- 现有 v6.0 直接调用 `ritsu_open_span` 的 SKILL 无需改动

---

### 3.2 Span 事件签名

#### 3.2.1 密钥管理

**路径**：`.ritsu/agent-keys/<agent_id>.key`（256-bit random）

**git 策略**：
- 默认 `.gitignore` 加入 `.ritsu/agent-keys/`
- 团队共享通过 out-of-band（密码管理器 / Vault / 1Password）
- 密钥永不入 git；轮换记录入 `.ritsu/agent-keys/.rotations.log`（可入 git）

**初始化**：
- `ritsu init-key <agent_id>` 生成
- 首次 `ritsu_emit_event` 检测无 key 时打印警告 + 提示初始化

#### 3.2.2 签名 schema 扩展

在 `_shared/ctx-event-schema.json` 新增可选字段：

```json
{
  "signature": {
    "type": "string",
    "pattern": "^[0-9a-f]{64}$",
    "description": "HMAC-SHA256 hex digest of canonical event content"
  },
  "key_id": {
    "type": "string",
    "pattern": "^[^:]+:[0-9a-f]{4}$",
    "description": "<agent_id>:<key-fingerprint-4-hex>"
  }
}
```

#### 3.2.3 签名算法

1. 提取事件除 `signature` / `key_id` 外的所有字段
2. 递归排序键名后 `JSON.stringify`（canonical form）
3. HMAC-SHA256(content, agent_key) → hex digest
4. `key_id = agent_id + ":" + sha256(agent_key).slice(0,4)`

#### 3.2.4 验证流程

```typescript
ritsu_verify_trace(params: {
  trace_id: string;
}): Promise<{
  total_events: number;
  verified: number;
  unsigned: number;
  invalid: Array<{ span_id: string; ts: string; reason: string }>;
}>
```

CLI：
```bash
$ ritsu trace --verify trace-20260515-a3f9c4b8e1d27f06

trace: trace-20260515-a3f9c4b8e1d27f06
events: 12 total
  ✓ 10 verified
  ⚠  1 unsigned (legacy)
  ✗  1 invalid signature  → span-7e1a92c5 at 10:40:05 (key mismatch)
```

#### 3.2.5 强制模式

- 默认：未签事件 warn 不阻塞（兼容 v6.0 老事件 + 未配密钥的 agent）
- `RITSU_REQUIRE_SIGNATURES=1`：未签事件 emit 时直接 errorResult；read 时计入 invalid
- 推荐 CI 上设此环境变量

#### 3.2.6 集成点

- `ritsu_emit_event`：写入前自动签名（若有 agent key）
- `ritsu_close_span`：close 时调用 `verify_trace` 子链路（仅自身 span + 子 span）

---

### 3.3 File Lease（并行 agent 文件协调）

#### 3.3.1 存储格式

`.ritsu/leases/<sha256(path).hex>.lease`：

```json
{
  "path": "src/auth/login.ts",
  "agent_id": "claude-opus-4-7",
  "span_id": "span-7e1a92c5",
  "trace_id": "trace-20260515-...",
  "claimed_at": "20260515-104000",
  "expires_at": "20260515-104500",
  "purpose": "edit"
}
```

#### 3.3.2 新 handler

```typescript
ritsu_claim_file(params: {
  path: string;
  ttl_ms?: number;          // 默认 5 分钟
  purpose?: "edit" | "read-exclusive";
}): Promise<
  | { ok: true; lease_id: string; expires_at: string }
  | { ok: false; conflict: { agent_id: string; span_id: string; expires_at: string } }
>

ritsu_release_file(params: {
  lease_id: string;
}): Promise<{ ok: boolean }>

ritsu_list_leases(params: {}): Promise<{
  leases: Array<{ path; agent_id; span_id; expires_at; ttl_remaining_ms }>;
}>
```

#### 3.3.3 行为

- `claim_file` 用 `proper-lockfile` 短锁保护 `.lease` 文件原子创建
- 若已存在且 `expires_at` 未过 → 返回 conflict 信息（调用方决定 wait/abort）
- 若已存在但过期 → 删除并 claim 成功
- `release_file` 立即删除 `.lease` 文件

#### 3.3.4 集成点

- `ritsu_write_artifact`：写入前自动 `claim_file(path, "edit")`，写完 `release_file`
- 用户 SKILL（如 dev）在批量改源码前可显式 claim 各文件

#### 3.3.5 死锁防御

- TTL 必填（默认 5 分钟）→ agent 崩溃后最坏 5 分钟自动释放
- `ritsu lease cleanup` 手动清理所有过期 lease
- `ritsu_close_span` 时 auto-release 该 span 持有的所有 lease

---

### 3.4 coordination-sheet 机器可读升级

#### 3.4.1 新 frontmatter

老的 `coordination-sheet` 是纯 Markdown；v6.1 在顶部加 YAML frontmatter：

```yaml
---
ritsu_version: 6.1.0
trace_id: trace-20260515-a3f9c4b8e1d27f06
created_at: 20260515-103000
planner_agent: claude-opus-4-7

task_assignments:
  - task_id: T1
    skill: dev
    description: "实现前端 OAuth 流"
    in_scope: [src/auth/, src/components/Login.tsx]
    out_of_scope: [server/]
    depends_on: []
    status: pending           # pending | claimed | done | failed
    assigned_to: null         # agent_id (claim 后填入)
    span_id: null             # span_id (claim 后填入)
    contracts: [C1, C2]       # 引用 design-sheet.contracts[]
  - task_id: T2
    skill: dev
    description: "实现后端 token store"
    in_scope: [server/auth/, server/db/migrations/]
    depends_on: []
    status: pending
    contracts: [C3, C4]
  - task_id: T3
    skill: review
    description: "合并验收 + 跨契约一致性"
    in_scope: []
    depends_on: [T1, T2]
    status: pending
    contracts: [C1, C2, C3, C4]

integration_points:
  - id: I1
    description: "前后端 OAuth 契约"
    schema_path: ".ritsu/contracts/auth.openapi.yaml"
    enforced_by: [T1, T2]
---

# Coordination Sheet
（v6.0 模板的人类可读内容保留在 frontmatter 之后）
```

#### 3.4.2 Schema 校验

在 `_shared/artifact-schema.yaml` 的 `coordination_sheet` 节加 frontmatter 字段约束：
- `task_assignments[]`: 至少 1 项；每项必填 task_id/skill/description/depends_on/status
- `task_id` 必须唯一
- `depends_on` 中的 ID 必须存在
- 检测循环依赖（拓扑排序失败则报错）

`write-artifact` 写入 coordination-sheet 时强制解析 frontmatter 并校验。

---

### 3.5 任务 Claim 协议

#### 3.5.1 新 handler

```typescript
ritsu_claim_task(params: {
  trace_id: string;
  task_id: string;
  agent: { id: string; role: string; session_id?: string };
}): Promise<
  | { ok: true; span_id: string; in_scope: string[]; depends_on: string[]; contracts: string[] }
  | { ok: false; reason: "already_claimed" | "deps_unmet" | "not_found"; details?: object }
>

ritsu_complete_task(params: {
  task_id: string;
  verdict: "done" | "failed";
  artifact_paths?: string[];
}): Promise<{
  ok: boolean;
  unblocked_tasks: string[];   // 由此变为 claimable 的下游 task_id
}>

ritsu_list_pending_tasks(params: {
  trace_id: string;
}): Promise<{
  claimable: Array<{ task_id; skill; description; in_scope; contracts }>;  // deps 已 done
  blocked: Array<{ task_id; blocked_by: string[] }>;
  in_progress: Array<{ task_id; assigned_to; span_id; claimed_at }>;
}>
```

#### 3.5.2 行为

1. **claim_task**：
   - 用 file lease 保护 coordination-sheet
   - 检查 status === pending
   - 检查 depends_on 全部 done
   - 更新 frontmatter：status → claimed，assigned_to → agent_id
   - 自动 `ritsu_open_span` 开 span，并把 span_id 写入 task_assignments
   - 释放 lease
   - 返回 span_id + 任务约束（in_scope / contracts）供 agent 后续工作

2. **complete_task**：
   - claim coordination-sheet
   - 更新 status → done/failed
   - 自动 `ritsu_close_span`
   - 扫描所有 pending task，找出 depends_on 全部 done 的 → 返回为 unblocked

3. **list_pending_tasks**：
   - 只读，返回三类（可领 / 被阻塞 / 进行中）
   - 子 agent 启动后通常先调用此 API 决定要不要领任务

#### 3.5.3 事件 schema 扩展

ctx-event-schema.json 的 `status` 枚举增加：
- `task_claimed`
- `task_completed`
- `task_unblocked`（自动 emit，标记某 task 因依赖完成而变可领）

---

## 4. 改造的现有 Handler

| Handler | v6.1 改动 |
|---|---|
| `ritsu_emit_event` | 自动签名（若有 agent key）；启动时读 `RITSU_TRACE_PARENT` 注入 trace/span 上下文 |
| `ritsu_open_span` | 接受可选 `task_id` 参数，写入 span 关联；自动从 ENV 继承 |
| `ritsu_close_span` | 调用 `verify_trace` 验证自身链路；release 该 span 持有的所有 file lease |
| `ritsu_write_artifact` | 写入前 auto-claim file lease，写完 release；coordination-sheet 类型走 §3.4 校验 |
| `ritsu_join_trace` | 返回新增的 `task_assignments` 状态摘要 |

---

## 5. CLI 升级

| 命令 | 用途 |
|---|---|
| `ritsu trace --verify <id>` | 验证 trace 内所有事件签名 |
| `ritsu trace --inject [--span <id>]` | 输出 `export RITSU_TRACE_PARENT=...` |
| `ritsu lease list` | 列出当前所有 file lease |
| `ritsu lease cleanup` | 清理过期 lease |
| `ritsu lease release <lease_id>` | 手动释放 lease |
| `ritsu task list <trace_id>` | 列出 trace 内所有任务及状态 |
| `ritsu task claim <task_id> --agent <id>` | 手动 claim 任务（调试/恢复用） |
| `ritsu task complete <task_id> --verdict <done\|failed>` | 手动完成任务 |
| `ritsu init-key <agent_id>` | 初始化 agent 签名密钥 |

---

## 6. 安全考虑

| 风险 | 对策 |
|---|---|
| HMAC 密钥泄露 | 项目级 rotate；新 key 写入 `.ritsu/agent-keys/.rotations.log`；老 key fingerprint 加入 revoked list |
| 重放攻击（同签名 重发） | 事件含 `ts`（HHMMSS 精度）+ ctx-writer lock 保证同一 ts 不重复；read 时检测重复 ts+span_id 视为可疑 |
| 流氓 agent 用别人 key | 单机信任模型：通过 fs 权限隔离（密钥文件 0600）；v6.2+ 评估非对称签名 |
| Lease 死锁（agent 崩溃） | TTL 默认 5 分钟 + lazy cleanup + close_span 触发 release |
| 跨进程 ENV 泄露 trace_id 给非 ritsu 进程 | trace_id 本身非敏感；用户责任避免传递到不可信进程；ENV 不含密钥 |
| coordination-sheet 被恶意修改打破依赖关系 | claim_task 时校验 frontmatter 完整性 + 签名（若启用） |
| Symlink 攻击穿越 lease | 路径在 hash 前 normalize；解 symlink 后 hash 真实路径 |

---

## 7. 性能考虑

| 操作 | 开销 | 缓解 |
|---|---|---|
| HMAC-SHA256 单次 | ~5μs | 每条事件可接受 |
| Lease 文件 stat + 读 | ~1ms | 高并发场景考虑 in-memory cache（v6.2 评估） |
| coordination-sheet 解析 + 校验 | ~5ms (含 frontmatter parse) | 仅在 claim/complete 时触发 |
| verify_trace 全链路 | O(N) 事件数 | 仅 close_span / `--verify` 触发，非热路径 |
| task_unblocked 扫描 | O(M) 任务数 | M 通常 <50 |

---

## 8. 向后兼容

### 8.1 v6.0 → v6.1 平滑升级

- v6.0 trace + v6.1 trace 在同一 ctx 文件并存
- v6.1 reader 解析无 signature 的事件：视为 unsigned；默认 warn 不阻塞
- v6.0 coordination-sheet（无 frontmatter）：v6.1 reader 降级为纯人读 mode，task_claim API 对其不可用并明确报错

### 8.2 deprecation 时间表

| 版本 | 签名 | RITSU_TRACE_PARENT | coordination-sheet frontmatter |
|---|---|---|---|
| v6.1 | optional, warn 未签 | optional | optional, 老格式仍解析 |
| v6.2 | required（write 时强制；read 兼容） | required（多 agent 任务） | required（write 时强制） |
| v7.0 | (待 RFC) | (待 RFC) | (待 RFC) |

---

## 9. Open Questions

| # | 问题 | 推荐答案 | 状态 |
|---|---|---|---|
| Q1 | trace_id 是否需要跨项目全局唯一？ | 否，仅 .ritsu/ 内部局部唯一即可 | Settled |
| Q2 | Lease TTL 默认值？ | 5 分钟；AGENTS.md 可调（`ritsu.lease_default_ttl_ms`） | Tentative |
| Q3 | 签名算法升级到 ed25519？ | v6.2+；等真正需要团队层非对称信任 | Out of scope |
| Q4 | task_claimed / task_completed 是否单独 ctx 事件类型？ | 是，加入 status 枚举 | Settled |
| Q5 | RITSU_TRACE_PARENT vs OTel TRACEPARENT 双兼容？ | v6.1 仅自用；v6.2+ 加 OTel 解析 fallback | Out of scope |
| Q6 | coordination-sheet 中 contracts 关联是否双向同步到 design-sheet？ | 单向引用即可（task → contract id）；design-sheet 不感知 task | Settled |
| Q7 | file lease 的 path 是否支持 glob？ | v6.1 仅 exact path；目录级 lease 是 v6.2 议题 | Tentative |

---

## 10. 实现拆解（Phase E Epic）

| Epic | 内容 | 估算 |
|---|---|---|
| **E10-S1** | RITSU_TRACE_PARENT 协议 + `inject_trace_context` / `extract_trace_context` handler | 1 周 |
| **E10-S2** | HMAC 签名 schema 升级 + `sign_event`（内部）+ `verify_trace` + CLI `--verify` + `init-key` | 2 周 |
| **E10-S3** | File lease 三件套 handler（claim/release/list）+ write-artifact 集成 + close-span auto-release | 1.5 周 |
| **E10-S4** | coordination-sheet YAML frontmatter schema + artifact-schema.yaml 升级 + write-artifact 校验 | 1 周 |
| **E10-S5** | `claim_task` / `complete_task` / `list_pending_tasks` handler + CLI `task ...` | 1.5 周 |
| **E10-S6** | 跨进程 demo（CLI 启动子 CLI；planner → executor → reviewer 跨 3 个 shell 串联）+ 集成测试 | 1 周 |
| **总计** | | **~8 周** |

---

## 11. 验证（DoD for v6.1）

```bash
# §3.1 跨进程
$ ritsu trace --inject > .trace-env && source .trace-env
$ ritsu_open_span ...   # 新 span 自动 parent_span_id 来自 ENV

# §3.2 签名
$ ritsu init-key claude-opus-4-7
$ /r-dev ...
$ ritsu trace --verify <trace_id>     # 期望所有事件 ✓ verified
$ # 故意篡改一行 ctx-*.jsonl
$ ritsu trace --verify <trace_id>     # 期望 1 invalid signature

# §3.3 File lease
$ ritsu_claim_file path=src/a.ts ttl_ms=300000   # ok
$ ritsu_claim_file path=src/a.ts                  # conflict + agent_id

# §3.4 / §3.5 coordination + task
$ /r-think ...   # planner 写出含 task_assignments 的 coordination-sheet
$ ritsu task list <trace_id>          # 输出 claimable / blocked / in_progress
$ ritsu task claim T1 --agent gpt-5   # 返回 span_id + in_scope
$ ritsu task complete T1 --verdict done  # 输出 unblocked: [T3]
```

**整体 DoD**：
- 三个异构 shell（模拟三个 agent）跨进程协作完成一个 PR；最终 `ritsu trace --verify` 全绿
- 故意让两个 agent claim 同一个 task → 第二个失败 with `already_claimed`
- 故意让两个 agent claim 同一个文件 → 第二个失败 with conflict 信息

---

## 12. 决策日志

| 日期 | 决策 | 备注 |
|---|---|---|
| 2026-05-15 | 初稿起草；scope = 中集（跨进程 + 签名 + lease + task claim） | 用户决策 |
| TBD | Q2 lease TTL 默认值最终拍板 | 影响 E10-S3 |
| TBD | Q7 lease 是否扩展支持目录级 | v6.2 时回头看 |

---

## 13. 引用

- [RFC-001 Multi-Agent Trace Protocol](./001-multi-agent-trace.md)
- [W3C Trace Context Specification](https://www.w3.org/TR/trace-context/)
- [HMAC: Keyed-Hashing for Message Authentication (RFC 2104)](https://www.rfc-editor.org/rfc/rfc2104)
- 现行 v6.0 实现：`runtime/src/handlers/open-span.ts`、`close-span.ts`、`join-trace.ts`
- 路线上下文：[../ROADMAP.md](../ROADMAP.md) Phase E
