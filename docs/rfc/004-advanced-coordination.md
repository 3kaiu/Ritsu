# RFC-003: Advanced Coordination & Observability

| | |
| --- | --- |
| **Status** | Draft |
| **Author** | 3kaiu |
| **Created** | 2026-05-15 |
| **Target Version** | v6.2.0 |
| **Builds On** | [RFC-001](./001-multi-agent-trace.md) v6.0.0 + [RFC-002](./003-multi-agent-collaboration.md) v6.1.0 |
| **Phase** | Phase F (Post v6.1, ~10 weeks) |

---

## 1. 背景与动机

### 1.1 协议演进梯队

| 版本 | RFC | 核心能力 | 一句话定位 |
|---|---|---|---|
| v6.0 | RFC-001 | trace/span/agent | 事件可归属、调用树可重建 |
| v6.1 | RFC-002 | 跨进程 + 签名 + lease + task claim | 多 agent 可执行协作 |
| **v6.2** | **本 RFC** | capability + budget + OTel + ed25519 | **协作可优化、可观测、可对外集成** |

### 1.2 RFC-001/002 明言推延到 v6.2+ 的事

| 来源 | 内容 | 本 RFC 处理 |
|---|---|---|
| RFC-001 §10 Q1 | AST 跨 span artifact 关联校验 | 不在本 RFC（独立 RFC） |
| RFC-002 §2.2 | capability negotiation | **§3.1 落地** |
| RFC-002 §2.2 / §10 | budget / token 跟踪 | **§3.2 落地** |
| RFC-002 §6 | ed25519 非对称签名 | **§3.4 落地（团队层信任）** |
| RFC-002 §9 Q5 | OTel TRACEPARENT 双向 | **§3.3 落地** |
| RFC-002 §9 Q7 | directory-level lease | **§3.5 落地** |

### 1.3 v6.2 thesis

**Ritsu 在多 agent 真协作的基础上，让协作可优化、可观测、可对外集成——但不增加新人学习曲线。**

具体三层：
- **可优化**：planner 知道哪个 agent 能做什么；任务有预算约束
- **可观测**：trace 能进 Prometheus/Jaeger；`doctor --metrics` 输出统计
- **可对外集成**：OTel TRACEPARENT 双向；签名升级到非对称团队信任

---

## 2. 设计目标

### 2.1 必须达成

1. **Capability Registry**：每个 agent 声明能力，planner 可查询匹配
2. **Budget Tracking**：task 级 token / duration / cost 预算 + 实时消耗
3. **OTel TRACEPARENT 双向**：既能 import 既有上下文，也能 export 给下游
4. **Optional ed25519 升级**：HMAC 共存，团队层非对称信任可选
5. **Directory-level lease**：path 支持目录前缀，目录与子文件 lease 互斥
6. **Metrics CLI**：`ritsu doctor --metrics` 出全维度统计

### 2.2 显式非目标

- ❌ **不引入实时调度器**：planner 决定，Ritsu 不做 task 重排
- ❌ **不做付费/计费功能**：budget 是约束不是结账
- ❌ **不做 OTel collector / agent 自身**：仅协议兼容，导出供用户接 Jaeger/Honeycomb
- ❌ **不替代 Prometheus / Grafana**：metrics CLI 一次性快照，不做时序数据库
- ❌ **不引入服务化注册中心**：capability 仍是文件配置

---

## 3. 协议规范

### 3.1 Agent Capability Registry

#### 3.1.1 存储

`.ritsu/agents/<agent_id>.yaml`：

```yaml
agent_id: claude-opus-4-7
version: "4.7"
capabilities:
  skills: [think, dev, review, hunt, augment]
  domains: [frontend, backend, fullstack, data]
  languages: [typescript, javascript, python, go, rust]
  max_loc_per_task: 500
  max_tokens_per_call: 200000
  signing: [hmac-sha256, ed25519]
preferences:
  prefers_tier: [critical]              # 主要承担 P2
  cost_per_1k_tokens_usd:
    input: 0.015
    output: 0.075
```

**注册策略**：
- 文件由 agent 主动注册（`ritsu_register_capability`）或人工放置
- 多人项目时入 git（公开能力清单）
- 版本字段允许同一 agent 的多版本共存（`claude-opus-4-7` vs `claude-opus-4-6`）

#### 3.1.2 新 handler

```typescript
ritsu_register_capability(params: {
  agent_id: string;
  version?: string;
  capabilities: {
    skills?: string[];
    domains?: string[];
    languages?: string[];
    max_loc_per_task?: number;
    max_tokens_per_call?: number;
    signing?: ("hmac-sha256"|"ed25519")[];
  };
  preferences?: { prefers_tier?: string[]; cost_per_1k_tokens_usd?: object };
}): Promise<{ ok: boolean; path: string }>

ritsu_query_capabilities(params: {
  required: {
    skill?: string;
    domain?: string;
    language?: string;
    min_loc?: number;
    min_tokens?: number;
  };
}): Promise<{
  matches: Array<{ agent_id: string; version: string; capabilities: object; fitness_score: number }>;
}>
```

#### 3.1.3 集成点

- **think SKILL P2**：在写 coordination-sheet 前调用 `query_capabilities` 决定 task_assignments[].assigned_to 候选
- **task claim**：claim_task 时若 agent.id 不在 registry，仅 warn（不阻塞），但记入 `unregistered_agent` ctx 事件

---

### 3.2 Budget Tracking

#### 3.2.1 coordination-sheet task_assignments[] 扩展

RFC-002 §3.4 的 frontmatter 增字段：

```yaml
task_assignments:
  - task_id: T1
    # ... RFC-002 字段
    budget:
      tokens_max: 50000
      duration_ms_max: 600000
      cost_usd_max: 5.0
    budget_consumed:                # 由 close_span 自动更新
      tokens: 32100
      duration_ms: 412000
      cost_usd: 3.21
```

#### 3.2.2 新 handler

```typescript
ritsu_check_budget(params: {
  task_id: string;
}): Promise<{
  tokens_remaining: number;
  duration_ms_remaining: number;
  cost_usd_remaining: number;
  pct_consumed: number;   // 0-100，取最紧维度
  status: "healthy" | "warn" | "exhausted";  // <70% / <100% / ≥100%
}>

ritsu_reserve_budget(params: {
  task_id: string;
  tokens?: number;
  cost_usd?: number;
}): Promise<
  | { ok: true; reservation_id: string }
  | { ok: false; reason: "insufficient"; remaining: object }
>

ritsu_release_reservation(params: {
  reservation_id: string;
  actual_consumed: { tokens: number; cost_usd: number };
}): Promise<{ ok: boolean; final_state: object }>
```

#### 3.2.3 自动消耗追踪

- `ritsu_close_span` 时累加 cost 字段到 task_assignments[].budget_consumed
- 超出 max 时：
  - 默认：warn 留痕（emit `budget_exhausted` 事件）
  - `RITSU_BUDGET_STRICT=1` 时：拒绝继续 emit_event，强制 task 进入 failed 状态

#### 3.2.4 新 event status

ctx-event-schema.json `status` 枚举增加：
- `budget_warn`（消耗超过 70%）
- `budget_exhausted`（消耗超过 100%）

---

### 3.3 OTel TRACEPARENT 双向兼容

#### 3.3.1 Import (优先级)

子进程启动时按以下顺序查找 trace 上下文：

1. `RITSU_TRACE_PARENT`（v6.1 协议）—— **优先**
2. `TRACEPARENT`（W3C, RFC-002 §9 Q5 推延项）—— fallback

OTel `TRACEPARENT` 格式：
```
00-{32-hex-trace-id}-{16-hex-span-id}-{2-hex-flags}
```

转换规则：
- OTel trace_id (32 hex) → Ritsu `trace-{YYYYMMDD}-{first-16-hex}` （注：保留前 16 hex；剩余 16 hex 加入事件 `external_trace_id` 字段，便于回溯外部系统）
- OTel span_id (16 hex) → Ritsu `span-{first-8-hex}`
- flags 直接复用

#### 3.3.2 Export

新 CLI：

```bash
$ ritsu trace --otel trace-20260515-a3f9c4b8e1d27f06 --format jaeger > out.json
$ ritsu trace --otel trace-20260515-a3f9c4b8e1d27f06 --format zipkin > out.json
$ ritsu trace --otel trace-20260515-a3f9c4b8e1d27f06 --format otlp-json > out.json
```

支持的目标格式：
- `jaeger`（Jaeger Thrift JSON）
- `zipkin`（Zipkin v2 JSON）
- `otlp-json`（OpenTelemetry Protocol JSON）

#### 3.3.3 新增字段

ctx-event-schema 新增可选：
```json
{
  "external_trace_id": { "type": "string", "description": "原始 OTel trace_id (32 hex) for round-trip" },
  "external_span_id": { "type": "string" }
}
```

---

### 3.4 ed25519 升级（团队层非对称信任）

#### 3.4.1 与 HMAC 共存

- 已有 v6.1 HMAC 不删除——单 agent / 小团队仍可用
- v6.2 新增 ed25519 作为 **可选升级**
- 同一事件可有 HMAC + ed25519 双签（向后兼容）

#### 3.4.2 密钥布局

```
.ritsu/agent-keys/<agent_id>.ed25519.key       # 私钥, 0600, .gitignore
.ritsu/agent-keys/<agent_id>.ed25519.pub       # 公钥, 0644

.ritsu/team-trust/<agent_id>.ed25519.pub       # 团队信任的公钥集, 可入 git
.ritsu/team-trust/.trust-policy.yaml           # 信任策略
```

`.trust-policy.yaml`：

```yaml
require_signature_for:
  - tier: critical            # P2 任务必须有 ed25519 签名
revoked_keys:
  - agent_id: gpt-5
    fingerprint: a3f9c4b8
    revoked_at: 20260601-000000
    reason: "key rotation"
```

#### 3.4.3 schema 扩展

ctx-event-schema 的 `signature` / `key_id` 字段升级为可重复（数组）：

```json
{
  "signatures": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "algo": { "enum": ["hmac-sha256", "ed25519"] },
        "value": { "type": "string" },
        "key_id": { "type": "string" }
      }
    }
  }
}
```

向后兼容：v6.1 单 `signature` + `key_id` 字段保留，reader 自动转 `signatures: [{algo: "hmac-sha256", value, key_id}]`。

#### 3.4.4 集成点

- `ritsu init-key <agent_id> --algo ed25519` 生成密钥对
- `ritsu_emit_event` 根据 `.trust-policy.yaml` 决定要求哪个算法
- `ritsu trace --verify` 检查所有签名通过 + 无 revoked key

---

### 3.5 Directory-level Lease

#### 3.5.1 RFC-002 §3.3 扩展

`ritsu_claim_file` 的 `path` 字段允许：
- 文件路径（v6.1 已有）：`src/auth/login.ts`
- 目录路径（v6.2 新）：`src/auth/`（必须以 `/` 结尾）

#### 3.5.2 冲突规则

| Claim 类型 | 已有 lease 类型 | 已有 lease 路径 | 是否冲突 |
|---|---|---|---|
| 文件 `src/a.ts` | 文件 | `src/a.ts` | ✅ 是 |
| 文件 `src/a.ts` | 目录 | `src/` | ✅ 是 |
| 目录 `src/` | 文件 | `src/a.ts` | ✅ 是 |
| 目录 `src/` | 目录 | `src/auth/` | ✅ 是 |
| 目录 `src/auth/` | 目录 | `lib/` | ❌ 否 |

#### 3.5.3 实现

存储仍是 `.ritsu/leases/<sha256(path).hex>.lease`；冲突检测在 claim 时扫所有 `.lease`，比对 path 前缀关系。性能：lease 数量通常 <50，O(N) 可接受。

---

### 3.6 Metrics CLI

#### 3.6.1 命令

```bash
$ ritsu doctor --metrics [--since 30d] [--format json]

== Detector Hit Distribution (30d) ==
  POL-001 placeholder         : 142
  POL-002 ai-attribution      :  18
  POL-003 hardcoded-secret    :   3
  POL-004 version-drift       :  21
  POL-005 scope-creep         :  67
  CONTRACT-COV                :  44
  PREFERENCE-LINT             :  88
  TOTAL                       : 383

== Task Coordination (30d) ==
  tasks_claimed       : 89
  tasks_completed     : 81
  tasks_failed        :  4
  avg_claim_to_done   : 12m 30s
  budget_warn         : 11
  budget_exhausted    :  2

== Trace Stats (30d) ==
  total_traces        : 67
  avg_spans_per_trace : 3.4
  avg_trace_duration  : 28m
  unverified_events   :  5 (warn)

== Health Trend (90d) ==
  detector_hit_rate   : ↑ (42% → 58%)
  miner_promote_rate  : ↑ (8% → 14%)
  coverage_avg        : ↑ (61% → 74%)
  three_artifact_rate : → (82% stable)
```

#### 3.6.2 新增字段

`ritsu doctor` 增 `--metrics` 子命令；通过 `--format json` 可输出为机器可读 JSON 供 Grafana 拉取（用户自配 Prometheus pushgateway 或 cronjob 转发）。

#### 3.6.3 历史快照

每次 `--metrics` 运行写入 `.ritsu/health-snapshots.jsonl` 一条记录（如 v2-execution-priority 7.4 所设想），用于趋势计算。

---

## 4. 改造的现有 Handler

| Handler | v6.2 改动 |
|---|---|
| `ritsu_open_span` | 优先读 `RITSU_TRACE_PARENT`，fallback 读 OTel `TRACEPARENT` |
| `ritsu_close_span` | 自动调用 `release_reservation` 结算 budget 消耗 |
| `ritsu_emit_event` | 根据 `.trust-policy.yaml` 决定签名算法；多签时同步生成 |
| `ritsu_claim_task` | 校验 budget.tokens_max > 0；检查 agent capability 是否声明 skill |
| `ritsu_claim_file` | 支持目录前缀，扫历史 lease 做冲突检测 |
| `ritsu_verify_trace` | 检查 `.trust-policy.yaml` revoked_keys 列表 |
| `ritsu doctor` | 新 `--metrics` 子命令 |

---

## 5. CLI 升级（新增）

| 命令 | 用途 |
|---|---|
| `ritsu agent register --file <path>` | 注册 agent capability YAML |
| `ritsu agent list [--skill X]` | 列出可用 agent |
| `ritsu budget check <task_id>` | 查询当前预算余额 |
| `ritsu trace --otel <id> --format <fmt>` | OTel 兼容导出 |
| `ritsu trust policy show` | 显示当前信任策略 |
| `ritsu trust revoke <agent_id>:<fingerprint>` | 吊销 key |
| `ritsu doctor --metrics [--since N] [--format json]` | 全维度统计 |

---

## 6. 安全考虑

| 风险 | 对策 |
|---|---|
| 假 capability 注册（agent 声称能干超出实际） | 由 reviewer 阶段事后核验；capability 是"自报"，policy 不依赖单方声明 |
| ed25519 私钥泄露 | 与 HMAC 同等流程：trust-policy.yaml 加 revoked_keys；fingerprint 比对 |
| Budget 绕过（agent 不调 reserve 直接消耗） | budget_strict 模式下 close_span 强制对账 cost；不通过则 task=failed |
| OTel TRACEPARENT 假冒（external 系统注入虚假 trace） | external_trace_id 仅做关联标记，不参与 Ritsu 内部信任决策 |
| Directory lease 引起的低粒度锁竞争 | 文档建议：claim 目录前评估冲突；默认 TTL 缩短到 2 分钟 |

---

## 7. 性能考虑

| 操作 | 开销 | 缓解 |
|---|---|---|
| ed25519 签名 | ~30μs（HMAC 5μs 的 6 倍） | 仅 critical tier 强制；普通任务仍 HMAC |
| capability query | YAML 文件扫描 O(N agent) | N 通常 <10；考虑加 in-memory cache（v6.3+） |
| OTel export 转换 | 取决于 trace 长度 | 一次性操作，非热路径 |
| metrics 全量扫描 | O(M ctx 事件) | 默认 30d 窗口；M 通常 <10k |
| Directory lease 冲突检测 | O(L 现存 lease) | L <50 |

---

## 8. 向后兼容

| 维度 | v6.1 → v6.2 |
|---|---|
| 签名 | HMAC 与 ed25519 并存；trust-policy 控制要求 |
| Budget 字段 | coordination-sheet 无 budget 字段时默认 unlimited |
| Capability | 未注册 agent 仅 warn；不阻塞任务 |
| OTel import | TRACEPARENT 仅在 RITSU_TRACE_PARENT 缺失时 fallback |
| Directory lease | 老 lease 文件（仅文件 path）正常工作；新规则向前兼容 |
| Metrics | 旧 ctx 文件可统计（缺字段则该维度 0） |

---

## 9. Open Questions

| # | 问题 | 推荐答案 | 状态 |
|---|---|---|---|
| Q1 | Capability YAML 入 git 还是 gitignore？ | 入 git（公开能力清单是团队层资产） | Settled |
| Q2 | Budget 单位是否含 model 区分？ | 暂用统一 cost_usd；model-specific 在 capability.cost_per_1k_tokens_usd 表达 | Tentative |
| Q3 | OTel 兼容是否需要支持 binary protocol (gRPC)？ | 否，只支持 JSON 格式；binary 是 v7+ 议题 | Settled |
| Q4 | Metrics 历史快照保留多久？ | 365 天，老快照按月合并为日均值 | Tentative |
| Q5 | ed25519 是否做强制升级路径？ | v7.0 评估；v6.x 永远 HMAC + ed25519 并存 | Settled |
| Q6 | Directory lease 是否支持 glob（`src/**/*.ts`）？ | 否，仅前缀；glob 是 v7+ 议题 | Settled |
| Q7 | `query_capabilities` 是否应返回 cost 排序选项？ | 是，加 `optimize: "cost"\|"latency"\|"fitness"` 参数 | Tentative |

---

## 10. 实现拆解（Phase F Epic）

| Epic | 内容 | 估算 |
|---|---|---|
| **F1** | Capability Registry schema + register/query handler + CLI `agent ...` | 1.5 周 |
| **F2** | Budget 字段扩展 + check/reserve/release handler + close_span 集成 | 2 周 |
| **F3** | OTel TRACEPARENT 双向 import + open_span 改造 + external_trace_id 字段 | 1 周 |
| **F4** | OTel export（jaeger/zipkin/otlp-json 三格式） | 1.5 周 |
| **F5** | ed25519 升级：keygen + signatures[] schema + trust-policy + revoke | 2 周 |
| **F6** | Directory lease 扩展 + 冲突规则实现 + 测试 | 1 周 |
| **F7** | `ritsu doctor --metrics` + 历史快照 + JSON 输出 | 1.5 周 |
| **F8** | 集成测试 + 多 agent + 多 OTel 后端 demo | 1 周 |
| **总计** | | **~10 周** |

---

## 11. 验证（DoD for v6.2）

```bash
# §3.1 Capability
$ ritsu agent register --file claude.yaml
$ ritsu agent list --skill dev --domain backend
$ ritsu query_capabilities required={skill:dev,domain:backend,language:go}

# §3.2 Budget
$ /r-think     # 写出含 budget 的 coordination-sheet
$ ritsu task claim T1
$ ritsu budget check T1     # 输出 tokens_remaining
$ # 故意超 budget
$ ritsu_emit_event ... cost.tokens_in=60000  # 期望 status=budget_exhausted

# §3.3 OTel
$ TRACEPARENT=00-... ritsu_open_span ...    # 期望自动 fallback
$ ritsu trace --otel <id> --format jaeger | jq .data[0]   # 期望符合 Jaeger schema

# §3.4 ed25519
$ ritsu init-key claude-opus-4-7 --algo ed25519
$ ritsu trace --verify <id>   # 期望 ed25519 + hmac 双签都通过
$ ritsu trust revoke claude-opus-4-7:a3f9c4b8
$ ritsu trace --verify <id>   # 期望旧事件 invalid (revoked)

# §3.5 Directory lease
$ ritsu_claim_file path=src/        # ok
$ ritsu_claim_file path=src/auth/   # conflict
$ ritsu_claim_file path=lib/        # ok（独立目录）

# §3.6 Metrics
$ ritsu doctor --metrics --since 7d
$ ritsu doctor --metrics --format json | jq .detector_hits
```

**整体 DoD**：
- 一个真实多 agent PR 走完整链路：capability query → task claim with budget → 跨进程协作（v6.1）→ ed25519 签名 → OTel 导出到 Jaeger
- `ritsu doctor --metrics --since 30d` 在 Ritsu 自己仓库出 7 维统计无空指标
- 模型升级（Opus 4.7 → 4.8）只需新增一份 `.ritsu/agents/claude-opus-4-8.yaml`，无代码改动

---

## 12. 决策日志

| 日期 | 决策 | 备注 |
|---|---|---|
| 2026-05-15 | 初稿起草；scope = 6 项（capability/budget/OTel/ed25519/dir-lease/metrics） | 基于 RFC-001/002 forward refs |
| TBD | Q2 cost 是否 model-specific | 影响 F2 |
| TBD | Q4 metrics 历史保留策略 | 影响 F7 |
| TBD | Q7 query_capabilities 排序选项 | 影响 F1 |

---

## 13. 引用

- [RFC-001 Multi-Agent Trace Protocol](./001-multi-agent-trace.md)
- [RFC-002 Cross-Agent Collaboration Protocol](./003-multi-agent-collaboration.md)
- [W3C Trace Context Specification](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry Trace JSON Encoding](https://opentelemetry.io/docs/specs/otel/protocol/otlp/)
- [Jaeger Thrift Spec](https://github.com/jaegertracing/jaeger-idl)
- [Zipkin v2 API](https://zipkin.io/zipkin-api/)
- [ed25519 RFC 8032](https://www.rfc-editor.org/rfc/rfc8032)
- 现行实现：`runtime/src/handlers/`、`_shared/ctx-event-schema.json`、`_shared/artifact-schema.yaml`
