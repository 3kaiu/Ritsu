# RFC-001: Multi-Agent Trace Protocol

| | |
| --- | --- |
| **Status** | Draft |
| **Author** | 3kaiu |
| **Created** | 2026-05-15 |
| **Target Version** | v6.0.0 |
| **Replaces** | `correlation_id` (v5.x) |
| **Phase** | 2 (Months 6 – 12) |

---

## 1. 背景与动机

### 1.1 v5.x `correlation_id` 的设计与局限

当前协议（`_shared/ctx-event-schema.json`）使用单一字符串 `correlation_id = cid-YYYYMMDD-NNN` 标识一个任务的所有事件。该设计在**单 agent / 单 session** 场景下工作良好：

- ✅ 原子写入 + 锁内生成（`ctx-writer.ts:52`）
- ✅ 断点续传（`read-ctx.ts` 的 `recovery_context`）
- ✅ 熔断器（`computeCircuitBreaker`）

但在以下场景失效：

| 场景 | 失效表现 |
| --- | --- |
| 1 个 PR 由 planner-Opus + 3 个 executor-Sonnet 并发完成 | 无法区分哪段事件来自哪个 agent |
| 任务跨越多个 session（中断后第二天继续） | correlation_id 无法跨 session 关联多个 sub-task |
| AI 任务嵌套（dev 阶段触发 hunt 子任务） | 嵌套关系平铺为线性序列，无法回放调用树 |
| 与外部 observability 系统（OTel / Datadog）集成 | 协议不兼容 |

### 1.2 设计哲学

随着 AI 进入多 agent 协作时代，**Ritsu 应成为异构 agent 协作的中立 event ledger**。这是上一份产品评审里 Phase 2 的核心 thesis。

**核心断言**：Trace 协议升级是 Ritsu 从"个人协议"演进为"基础设施"的必要前置。

---

## 2. 设计目标

### 2.1 必须达成

1. **支持多 agent 并发**：同一个高层任务可被多个 agent 同时推进，每个 agent 写自己的 span 不互相覆盖
2. **支持嵌套**：父子 span 关系可表达 think→dev→hunt 的调用树
3. **支持跨 session**：trace 跨越多次 Claude session 仍可关联
4. **向后兼容**：v5.x 的 `correlation_id` 仍可读、可继续写（deprecation 期 ≥ 2 个 minor 版本）
5. **OTel 友好**：trace_id / span_id 字节长度与 W3C Trace Context 一致，允许未来直接 export 到 OTel collector

### 2.2 显式非目标

- ❌ **不引入 OTel SDK**：仅在格式上兼容，不增加运行时依赖
- ❌ **不实现分布式 trace 传播协议**：第一版只支持单机内的 trace；跨进程留待 v6.1
- ❌ **不替代 MCP 协议本身**：MCP 工具调用层不变，只是事件 schema 升级
- ❌ **不强制要求所有 skill 使用**：低复杂度任务仍可使用平铺 correlation_id

---

## 3. 协议规范

### 3.1 标识符格式

| 标识符 | 长度 | 格式 | 示例 |
| --- | --- | --- | --- |
| `trace_id` | 32 hex chars | `trace-YYYYMMDD-{16-hex}` | `trace-20260515-a3f9c4b8e1d27f06` |
| `span_id` | 16 hex chars | `span-{8-hex}` | `span-3f9c4b8e` |
| `parent_span_id` | 16 hex chars 或 null | 同 span_id | `span-3f9c4b8e` 或 `null` |

**生成方式**：
- `trace_id` 的 16 hex 部分使用 `crypto.randomBytes(8).toString('hex')`
- `span_id` 的 8 hex 部分使用 `crypto.randomBytes(4).toString('hex')`
- 包含日期前缀是为了人类可读 + 月度文件归档

**OTel 兼容性**：去掉 `trace-YYYYMMDD-` 与 `span-` 前缀后，分别是 16-byte / 8-byte hex，等于 W3C Trace Context 规范。

### 3.2 事件 Schema 扩展

新增字段（在 `_shared/ctx-event-schema.json` 中）：

```json
{
  "properties": {
    "trace_id": {
      "type": "string",
      "pattern": "^trace-\\d{8}-[0-9a-f]{16}$"
    },
    "span_id": {
      "type": "string",
      "pattern": "^span-[0-9a-f]{8}$"
    },
    "parent_span_id": {
      "type": ["string", "null"],
      "pattern": "^span-[0-9a-f]{8}$"
    },
    "agent": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },              // "claude-opus-4-7" / "gpt-5" / 自定义
        "role": { "enum": ["planner", "executor", "reviewer", "observer"] },
        "session_id": { "type": "string" }       // 同一 agent 跨 session 区分
      },
      "required": ["id", "role"]
    },
    "span_kind": {
      "enum": ["root", "internal", "client", "server"]
    },
    "correlation_id": {
      "type": "string",
      "pattern": "^cid-\\d{8}-\\d+$",
      "deprecated": true,
      "description": "v5.x compat field; auto-mapped from trace_id+span_id when reading legacy events"
    }
  },
  "required": ["ts", "trace_id", "span_id", "skill", "domain", "status"]
}
```

**关键变化**：
- `correlation_id` 从 required 变为 deprecated（保留 schema 描述以兼容老事件）
- `trace_id` / `span_id` 成为新 required
- 新增 `agent` 字段描述事件作者

### 3.3 事件示例

**单 agent 任务**（与 v5.x 几乎等价）：

```jsonl
{"ts":"20260515-103000","trace_id":"trace-20260515-a3f9c4b8e1d27f06","span_id":"span-3f9c4b8e","parent_span_id":null,"agent":{"id":"claude-opus-4-7","role":"executor"},"skill":"think","domain":"fullstack","status":"started","step":"1/4","span_kind":"root"}
{"ts":"20260515-103500","trace_id":"trace-20260515-a3f9c4b8e1d27f06","span_id":"span-3f9c4b8e","skill":"think","domain":"fullstack","status":"done","step":"4/4","agent":{"id":"claude-opus-4-7","role":"executor"}}
```

**多 agent 协作**（一个 trace 含多 span）：

```jsonl
# 1. Planner 启动主 trace
{"ts":"20260515-103000","trace_id":"trace-20260515-a3f9c4b8e1d27f06","span_id":"span-3f9c4b8e","parent_span_id":null,"agent":{"id":"claude-opus-4-7","role":"planner"},"skill":"think","status":"started","span_kind":"root"}
{"ts":"20260515-103400","trace_id":"trace-20260515-a3f9c4b8e1d27f06","span_id":"span-3f9c4b8e","agent":{"id":"claude-opus-4-7","role":"planner"},"skill":"think","status":"artifact_written","artifact":".ritsu/design-sheet-20260515-103400.md"}

# 2. Executor-A 加入，开启子 span
{"ts":"20260515-104000","trace_id":"trace-20260515-a3f9c4b8e1d27f06","span_id":"span-7e1a92c5","parent_span_id":"span-3f9c4b8e","agent":{"id":"gpt-5","role":"executor","session_id":"sess-001"},"skill":"dev","status":"started","span_kind":"internal"}

# 3. Executor-B 并发开启
{"ts":"20260515-104005","trace_id":"trace-20260515-a3f9c4b8e1d27f06","span_id":"span-8b2c40df","parent_span_id":"span-3f9c4b8e","agent":{"id":"gemini-2-pro","role":"executor","session_id":"sess-002"},"skill":"dev","status":"started","span_kind":"internal"}

# 4. 两个 executor 完成
{"ts":"20260515-110000","trace_id":"trace-20260515-a3f9c4b8e1d27f06","span_id":"span-7e1a92c5","agent":{"id":"gpt-5","role":"executor"},"skill":"dev","status":"done"}
{"ts":"20260515-110200","trace_id":"trace-20260515-a3f9c4b8e1d27f06","span_id":"span-8b2c40df","agent":{"id":"gemini-2-pro","role":"executor"},"skill":"dev","status":"done"}

# 5. Reviewer 接管
{"ts":"20260515-111000","trace_id":"trace-20260515-a3f9c4b8e1d27f06","span_id":"span-c4d5e6f7","parent_span_id":"span-3f9c4b8e","agent":{"id":"claude-opus-4-7","role":"reviewer","session_id":"sess-003"},"skill":"review","status":"started"}
{"ts":"20260515-112000","trace_id":"trace-20260515-a3f9c4b8e1d27f06","span_id":"span-c4d5e6f7","agent":{"id":"claude-opus-4-7","role":"reviewer"},"skill":"review","status":"done","artifact_meta":{"type":"assurance-sheet"}}
```

---

## 4. 新增 / 改动的 Handler

### 4.1 `ritsu_open_span`

```typescript
// 启动一个新 span，可选关联到既有 trace
ritsu_open_span(params: {
  trace_id?: string;          // 不传则新建 trace（root span）
  parent_span_id?: string;    // 嵌套子 span 时必传
  agent: { id: string; role: "planner"|"executor"|"reviewer"|"observer"; session_id?: string };
  skill: string;
  domain: string;
  step?: string;
  span_kind?: "root"|"internal"|"client"|"server";
}): Promise<{
  trace_id: string;
  span_id: string;
  is_root: boolean;
}>
```

行为：
- 不传 `trace_id` → 新建 root span 并返回新 trace_id
- 传 `trace_id` 不传 `parent_span_id` → 兄弟 span（同根）
- 都传 → 子 span
- 写入 `status: "started"` 事件

### 4.2 `ritsu_close_span`

```typescript
ritsu_close_span(params: {
  span_id: string;
  verdict: "done" | "failed";
  error?: string;
  artifact?: string;
  artifact_meta?: object;
}): Promise<{ written: boolean }>
```

### 4.3 `ritsu_join_trace`

```typescript
// 后到的 agent 查询既有 trace 状态以便协作
ritsu_join_trace(params: {
  trace_id: string;
  agent: { id: string; role: string; session_id?: string };
}): Promise<{
  root_span: SpanInfo;
  open_spans: SpanInfo[];       // 还未 close 的兄弟 span
  closed_spans: SpanInfo[];
  artifacts: string[];          // 这个 trace 产出的所有 artifact 路径
  recommended_action: string;   // 例: "executor-A 已完成 dev，可以开始 review"
}>
```

### 4.4 改造的 handler

| Handler | 改造点 |
| --- | --- |
| `ritsu_emit_event` | 接受 `trace_id`/`span_id`/`agent`，向后兼容 `correlation_id` 输入 |
| `ritsu_read_ctx` | 返回字段从扁平的 `last_incomplete/last_completed` 升级为 span tree |
| `ritsu_write_artifact` | 自动从当前 span 继承 trace/span 上下文（通过环境变量传） |

---

## 5. CLI 升级

### 5.1 `ritsu trace <trace_id>`

```bash
$ ritsu trace trace-20260515-a3f9c4b8e1d27f06

trace: trace-20260515-a3f9c4b8e1d27f06
duration: 1h 20m (10:30:00 → 11:20:00)
spans: 4 closed (4 done, 0 failed)

└─ span-3f9c4b8e  [planner|claude-opus-4-7]  think         ✓ done   1h 20m
   ├─ span-7e1a92c5  [executor|gpt-5]            dev           ✓ done   20m
   ├─ span-8b2c40df  [executor|gemini-2-pro]     dev           ✓ done   22m
   └─ span-c4d5e6f7  [reviewer|claude-opus-4-7]  review        ✓ done   10m

artifacts:
  - .ritsu/design-sheet-20260515-103400.md   (planner)
  - .ritsu/dev-report-20260515-110000.md     (executor|gpt-5)
  - .ritsu/dev-report-20260515-110200.md     (executor|gemini-2-pro)
  - .ritsu/assurance-sheet-20260515-112000.md (reviewer)
```

### 5.2 `ritsu trace --open`

列出当前所有未关闭的 trace，方便恢复中断会话。

### 5.3 `ritsu cat` 行为变更

老 `ritsu cat <cid>` 仍然有效：自动将 legacy `correlation_id` 映射为 `trace_id` 查询。

---

## 6. 新产物：`coordination-sheet`

适用于多 agent 协作任务的中央协调记录。

```markdown
# Coordination Sheet
# trace_id: trace-20260515-a3f9c4b8e1d27f06

## 1. 协作摘要
- Trace 创建: planner (claude-opus-4-7) at 10:30
- 参与 agent: 3 (planner × 1, executor × 2, reviewer × 1)
- 总时长: 1h 20m
- 总 token: 145,230

## 2. 任务分发
| Span | Agent | Skill | 任务 |
| --- | --- | --- | --- |
| span-7e1a92c5 | gpt-5 | dev | 实现前端 OAuth 流 |
| span-8b2c40df | gemini-2-pro | dev | 实现后端 token store |

## 3. 集成点 (Cross-Span Contract)
- 前端 ↔ 后端契约: OpenAPI schema at .ritsu/contracts/auth.yaml
- 双方均确认遵循该契约 → 见 span-7e1a92c5 的 dev-report 第 3 节

## 4. 冲突与裁决
- 无（如有，由 reviewer 在 assurance-sheet 中裁决）

## 5. 最终验收
- mergeable: yes
- 详见 .ritsu/assurance-sheet-20260515-112000.md
```

在 `ARTIFACT_REGISTRY`（`runtime/src/shared.ts:43`）新增条目：

```typescript
{ type: "coordination-sheet", prefix: "coordination-sheet-", layer: "primary" }
```

---

## 7. 向后兼容与迁移

### 7.1 读路径兼容

`ctx-reader.ts` 在解析 JSONL 时：

```typescript
if (entry.correlation_id && !entry.trace_id) {
  // legacy v5.x 事件：构造一个 synthetic trace_id/span_id
  entry.trace_id = legacyCidToTraceId(entry.correlation_id);
  entry.span_id = legacyCidToSpanId(entry.correlation_id);
}
```

`legacyCidToTraceId`：把 `cid-20260515-001` 映射到 `trace-20260515-{hash(001)}`。
保证查询老任务仍能用 `ritsu cat <cid>` 与 `ritsu trace <trace_id>`。

### 7.2 写路径迁移

- v6.0：`ritsu_emit_event` 同时接受 `correlation_id` 与 `trace_id`，**优先 trace_id**；若只传 correlation_id，runtime 自动生成对应的 trace/span
- v6.1：emit-event 输入 schema 把 correlation_id 标 deprecated
- v6.2：移除 correlation_id 输入支持，但读路径仍兼容老 jsonl

### 7.3 月度 jsonl 文件兼容

继续沿用 `.ritsu/ctx-YYYY-MM.jsonl`。多 agent 写入仍由 `proper-lockfile` 串行化，无需变更存储格式。

---

## 8. 安全考虑

| 风险 | 对策 |
| --- | --- |
| 一个流氓 agent 用别人的 trace_id 篡改事件 | 第一版不解决（单机信任模型）；v6.1 引入 span 签名 |
| trace_id 在多用户共享 .ritsu 目录下泄漏元数据 | 由 §10 Phase 3 的 `ritsu sync` 控制，不在本 RFC 范围 |
| agent.session_id 包含敏感信息 | 由调用方负责脱敏；schema 不强制内容格式 |

---

## 9. 性能考虑

- 单 trace 含 N 个 span，`ritsu_join_trace` 查询是 O(M) 全月度扫描（M = 月内事件数）
- 优化：在 `.ritsu/` 下维护一个 `trace-index.jsonl`，记录每个 trace_id 的事件偏移量（lazy 构建）
- 第一版不引入索引，等到 trace 数 > 1000 时触发
- 现有 tail-read 优化仍适用

---

## 10. Open Questions

| # | 问题 | 推荐答案 | 状态 |
| --- | --- | --- | --- |
| Q1 | 是否引入 ts-morph 类 AST 工具支持跨 span artifact 关联校验？ | 否，留给单独 RFC | Open |
| Q2 | `agent.id` 是否需要白名单（防止 "fake claude" agent 写入）？ | v6.0 不做；v6.1 引入 signing key | Open |
| Q3 | 跨进程 trace 传播（一个 Ritsu CLI 调用另一个）的协议？ | 用 `RITSU_TRACE_PARENT` 环境变量传 `trace_id:span_id` | Tentative |
| Q4 | Trace TTL：trace 在 ctx 文件里保留多久？ | 沿用月度文件，老月度文件保留但不索引 | Tentative |
| Q5 | 是否支持 OTel exporter（把 ritsu 事件 export 到 Jaeger）？ | 单独 RFC，本 RFC 只保格式兼容 | Out of scope |

---

## 11. 实现拆解（对应 Phase 2 Epic）

| Epic | 内容 | 估算 |
| --- | --- | --- |
| E4-S1 | Schema 升级 + 兼容 reader | 1 周 |
| E4-S2 | 新增 3 个 handler (`open_span`/`close_span`/`join_trace`) | 2 周 |
| E4-S3 | `emit-event` / `write-artifact` / `read-ctx` 改造 | 2 周 |
| E5-S1 | `coordination-sheet` artifact + schema | 1 周 |
| E5-S2 | `skills/think` / `skills/dev` / `skills/review` 升级使用 span 协议 | 2 周 |
| E6-S1 | `ritsu trace <id>` CLI 实现 | 1 周 |
| E6-S2 | `ritsu trace --open` + legacy 兼容测试 | 1 周 |
| 集成 | 跨模型 demo（Claude + GPT + Gemini 协作产 PR） | 2 周 |

**总计**：~12 周（与 Phase 2 的 6 个月窗口对齐，留 buffer 应对未知问题）

---

## 12. 决策日志

| 日期 | 决策 | 备注 |
| --- | --- | --- |
| 2026-05-15 | 初稿起草 | — |
| TBD | Q3 跨进程传播协议拍板 | 影响 E4-S2 |
| TBD | Q4 trace TTL 策略拍板 | 影响 ctx 文件归档 |

---

## 13. 引用

- [W3C Trace Context Specification](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry Trace Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/general/trace/)
- 上游产品评审：`docs/ROADMAP.md` §Phase 2
- 现行实现：`runtime/src/ctx-writer.ts`、`runtime/src/handlers/emit-event.ts`、`_shared/ctx-event-schema.json`
