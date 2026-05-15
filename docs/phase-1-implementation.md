# Phase 1 — 自洽 + 政策引擎雏形

> **窗口**：2026-05 起 6 个月
> **状态**：Drafting
> **目标版本**：v5.3.x – v5.4.x（v6.0 在 Phase 2 切换为 trace 协议）

---

## 1. 总体目标与 Definition of Done

把 Ritsu 从"提示 AI 自觉"升级为"运行时强校验"，让它能通过自己的红线。

**DoD（必须全部满足才宣告 Phase 1 完成）**：

- [ ] 全仓库所有版本号引用统一到当前发布版本，`ritsu doctor` 零警告
- [ ] `runtime/dist/` 不再被 git 追踪；CI 构建产物不含 orphan handler
- [ ] `ctx-event-schema.json` / `SKILL_STAGE_MAP` / `marketplace.json` / `README.md` / `CHANGELOG.md` 对 skill 集合的描述完全一致
- [ ] 至少 5 条 anti-pattern 由运行时拦截（不再依赖 LLM 自觉）
- [ ] 所有 handler 的输出在序列化前通过 `mcp-tools.yaml` 声明的 `output_schema` 校验
- [ ] `emit-event` schema 含 `cost` 字段，最低支持记录 `tokens_in / tokens_out / model`
- [ ] `read-ctx` 在 `detail=false` 且 ctx 文件 > 256 KB 时走 tail-read 路径，不再全量解析
- [ ] Ritsu 自己跑一次 `/r-review` Critical 路径，结论为 `mergeable`

---

## 2. 工作分解

三个 Epic，按顺序推进。E1 是 E2/E3 的前置（不自洽就没法谈拦截）。

```
E1 自洽收敛 ──────► E2 政策引擎雏形 ──────► E3 契约 & 可观测性
   (2 周)             (3-4 周)                (3-4 周)
```

---

## 3. Epic E1 — 自洽收敛

### 3.1 背景

当前仓库存在 3 类自洽问题：
1. **版本漂移**：6 处文件类型显示 v5.0.0，README/package/AGENTS 显示 v5.2.0
2. **构建腐烂**：`runtime/dist/` 含 23 个无源码对应的 .js 编译产物
3. **协议-实现不一致**：`ctx-event-schema.json` 的 skill 枚举与 `SKILL_STAGE_MAP` / 实际 skill 目录 / marketplace.json 互不对齐

### 3.2 Story 分解

#### S1.1 — 版本号单点真理 (Single Source of Truth)

**目标**：让 `runtime/package.json` 的 `version` 与 `ritsu_protocol_version` 成为唯一事实来源；其他文件由脚本注入。

**改动**：
| 文件 | 改动 |
| --- | --- |
| `runtime/version-check.js` | 升级为：扫所有文件类型版本，不一致退出非零 |
| `runtime/scripts/sync-version.js`（新） | 注入版本到 SKILL.md / _shared / domains / rules / marketplace.json |
| `.github/workflows/ci.yml` | 在 lint 前先跑 `node version-check.js`（已部分实现，需 hard fail） |
| `_shared/artifact-schema.yaml:124` | `pattern: "5.0.x"` → `pattern: "5.\\d+\\.x"` 或读包版本 |

**验收**：
```bash
cd runtime && node version-check.js   # exit 0
grep -rn "version: \"5\." ../skills ../_shared ../domains ../rules
# 全部一致
```

**复杂度**：S（小）

---

#### S1.2 — `runtime/dist/` 退出 git

**目标**：编译产物只在 CI / 发布时产生，本地构建不污染仓库。

**改动**：
1. `.gitignore` 第 8 行已有 `dist/`，但 `runtime/dist/` 当前被 git tracked（历史遗留）
2. 一次性 `git rm -r --cached runtime/dist`
3. 删除 23 个 orphan .js 文件对应的源 — 已删，无需再动
4. `runtime/package.json` 加 `"prepublishOnly": "npm run build"` 保证发包前编译

**验收**：
```bash
git ls-files runtime/dist | wc -l     # 0
npm run build && ls runtime/dist/handlers/*.js | wc -l   # 11（与 src/ 对齐）
```

**复杂度**：S（小）但**有破坏性**：必须在所有贡献者 PR rebased 后做

---

#### S1.3 — Skill 集合统一

**目标**：`ctx-event-schema.json` / `SKILL_STAGE_MAP` / `marketplace.json` / 实际 `skills/` 目录 / README / CHANGELOG 对 skill 集合的描述完全一致。

**决策点**（需先回答）：
- ❓ `test` skill 保留为独立阶段，还是合并入 `dev`？
- ❓ `freestyle` 是否进入 `skill` 枚举（即允许写 ctx 事件）？

**推荐答案**：
- `test` **删除独立阶段**，相关质量门禁能力并入 `dev` 的 Step 5（`ritsu_run_quality_gates`），并入 `review` 的红线扫描。SKILL.md/CHANGELOG/README/marketplace 同步删引用。
- `freestyle` **不进入 skill 枚举**，明确"不写 ctx"是设计意图，在 schema 描述里写明。

**改动**：
| 文件 | 改动 |
| --- | --- |
| `_shared/ctx-event-schema.json:19` | skill 枚举改为 `["init", "think", "dev", "hunt", "review"]`（保持，但 description 加注 freestyle 例外） |
| `runtime/src/shared.ts:16` | 删除 `test`，与 schema 对齐 |
| `runtime/src/handlers/read-ctx.ts:304` | 删除 `test` 分支 |
| `.claude-plugin/marketplace.json` | 删 `ritsu-triage`（目录不存在）；description 删 `/r-test` |
| `CHANGELOG.md` | "Explicit Staging" 改为 `think, dev, hunt, review`；标注 test 合并到 dev |
| `README.md:34` | 同步 |

**验收**：
```bash
# schema enum、SKILL_STAGE_MAP、skills/ 目录三方一致
node -e 'const s=require("./_shared/ctx-event-schema.json"); console.log(s.properties.skill.enum)'
ls skills/
grep -A5 SKILL_STAGE_MAP runtime/src/shared.ts
```

**复杂度**：M（决策成本 > 实现成本）

---

#### S1.4 — AGENTS.md 加入 Ritsu Configuration Block

**目标**：让 `ritsu_read_agents` 不再每次返回 fallback warning。

**改动**：
- 在仓库根 `AGENTS.md` 加入：
  ```html
  <!-- Ritsu Configuration Block -->
  ritsu-version: 5.3.0
  domain: fullstack
  tech_fingerprints:
    - nodejs
    - typescript
  rules_overrides:
    disable: []
    downgrade: []
  <!-- End Ritsu Block -->
  ```
- `skills/init/SKILL.md` Step 2 模板加入此块的生成逻辑（对新项目）

**验收**：`ritsu_read_agents` 返回不带 `_warning` 字段

**复杂度**：XS

---

#### S1.5 — README/CHANGELOG 清理"空头支票"

**目标**：删除引用了已不存在功能的文案。

**待清理**：
- `README.md:16`：`强制执行契约校验 (contract-validate)` —— contract-validate handler 不存在
- `CHANGELOG.md:32`：`test` skill 引用（如 S1.3 决策为删）
- `.claude-plugin/marketplace.json` 各 plugin 的 description 修正

**复杂度**：XS

---

### 3.3 E1 验收

执行如下命令，全部通过即 E1 完成：

```bash
cd runtime
node version-check.js                 # 退出 0
npm run build                         # dist 中 .js 数 = src 中 .ts 数
npm test                              # 全绿
node dist/cli.js doctor               # 零警告
```

---

## 4. Epic E2 — 政策引擎雏形

### 4.1 背景与设计原则

当前 `rules/anti-patterns.yaml` 是纯文档，靠 LLM 自觉。E2 把 5 条规则改为运行时强校验。

**设计原则**：
1. **不引入重量级 DSL**：用 YAML 声明 + TypeScript 实现 detector，不引入 OPA/Cedar
2. **可降级**：每条规则可在 `AGENTS.md` 的 `rules_overrides.disable/downgrade` 中调整
3. **可观测**：每次拦截/警告都发 `violation` 事件到 ctx，可被 retro 复盘

### 4.2 新增 / 改动

#### S2.1 — 新 handler `ritsu_policy_check`

**接口**：

```typescript
// runtime/src/handlers/policy-check.ts
export async function ritsu_policy_check(params: {
  action: "write_artifact" | "emit_event" | "commit_diff";
  target?: string;          // 文件路径 / artifact 内容 / diff 内容
  content?: string;
  context?: {
    skill?: string;
    correlation_id?: string;
    in_scope_files?: string[];  // 来自 design-sheet
  };
}): Promise<{
  passed: boolean;
  violations: Array<{
    rule_id: string;       // "POL-001"
    severity: "fatal" | "error" | "warn";
    message: string;
    evidence?: string;     // 触发该规则的具体字符串/行号
    suggestion?: string;
  }>;
}>;
```

**集成点**：
- `ritsu_write_artifact` 写入前调用 `policy_check({ action: "write_artifact", content })`
- `ritsu_emit_event` 在 `status: artifact_written` 时调用
- 可手工调用用于预检 diff

---

#### S2.2 — `anti-patterns.yaml` 扩展可执行字段

新增 `detector` 字段（声明检测方式）：

```yaml
# rules/anti-patterns.yaml
global:
  - id: AP-6
    name: Placeholder promises
    pattern: "在交付的代码或设计方案中留下 TODO/TBD/后续实现"
    severity: FATAL
    detector:
      type: regex
      target: artifact_content
      patterns:
        - "\\bTODO\\b"
        - "\\bTBD\\b"
        - "待定|暂不处理|后续完善"
      exemption:
        # init 阶段 AGENTS.md 占位允许
        - when: { skill: init, target_file: "AGENTS.md" }
```

支持的 `detector.type`：
| 类型 | 实现 | 适用规则 |
| --- | --- | --- |
| `regex` | 字符串正则匹配 | AP-6 placeholder、AP-9 attribution、R-3 secrets |
| `ast` | ts-morph AST 校验 | AP-2 unknown identifiers（Phase 1.5 可选） |
| `cross_file` | 多文件一致性检查 | R-2 version drift |
| `scope_diff` | 比较 diff 文件 ∩ design-sheet in_scope | AP-4 scope creep |

---

#### S2.3 — 初版实现 5 条政策

| ID | 规则 | 来源 AP/R | 检测方式 | 严重度 |
| --- | --- | --- | --- | --- |
| **POL-001** | Placeholder content | AP-6 | regex (TODO/TBD/待定…) | FATAL |
| **POL-002** | AI attribution leak | AP-9 | regex (`Co-authored-by:\s*(Claude\|GPT\|AI\|Anthropic)`) | FATAL |
| **POL-003** | Hardcoded secrets | R-3 | regex (API_KEY/TOKEN/PASSWORD = "…" 模式) | HARD_STOP |
| **POL-004** | Version drift | R-2 | cross_file (扫所有 version 字段一致性) | HARD_STOP |
| **POL-005** | Scope creep | AP-4 | scope_diff (`design-sheet.in_scope` vs `git diff --name-only`) | ERROR |

**关键代码位置**：
- `runtime/src/policy/index.ts`（新）：detector 调度器
- `runtime/src/policy/detectors/regex.ts`（新）
- `runtime/src/policy/detectors/cross-file.ts`（新）
- `runtime/src/policy/detectors/scope-diff.ts`（新）

POL-001 的 regex 已部分存在于 `write-artifact.ts:344`，需要重构为复用 policy engine。

---

#### S2.4 — violation 事件 schema 扩展

```json
// _shared/ctx-event-schema.json (新增)
"properties": {
  "violation": {
    "type": "object",
    "properties": {
      "rule_id": { "type": "string", "pattern": "^(POL|AP|R)-\\d+$" },
      "severity": { "enum": ["fatal", "error", "warn", "hard_stop"] },
      "evidence": { "type": "string" },
      "blocked": { "type": "boolean" }
    },
    "required": ["rule_id", "severity"]
  }
}
```

新增 `status: "violation_detected"`（仅在 strict=false 模式下降级用），强模式下直接 errorResult 拒绝。

---

#### S2.5 — 与 `AGENTS.md` 的 `rules_overrides` 联动

```yaml
# AGENTS.md 中的 Ritsu Configuration Block
rules_overrides:
  disable: ["POL-005"]              # 项目不强制 scope creep 检查
  downgrade:
    - id: POL-001
      severity: WARN                # 把 FATAL 降为 WARN
```

`policy_check` 加载时合并 `anti-patterns.yaml` + AGENTS.md overrides。

### 4.3 E2 验收

```bash
# 测试用例（在 runtime/tests/policy/）
npx vitest run policy

# 集成验证：写一个含 TODO 的 design-sheet
echo "## 实施清单\n- [ ] TODO: 待补充" > /tmp/bad.md
# 期望 ritsu_write_artifact 返回 violations: [{ rule_id: POL-001 ... }]
```

---

## 5. Epic E3 — 契约 & 可观测性

### 5.1 S3.1 — handler `output_schema` 强校验

**问题**：`runtime/src/schema-compiler.ts:107` 只编译 `t.input`，`t.output_schema` 被存但未使用。

**改动**：
1. `schema-compiler.ts` 把 `output_schema` 转 zod
2. `runtime/src/index.ts` 注册 handler 时包一层：调用后用 outputSchema parse，失败则 throw（dev 模式）或 log warning（prod 模式）
3. 用 `RITSU_STRICT_OUTPUT=1` 环境变量开启 dev 模式

**预期影响**：当前若干 handler 的返回值可能不严格符合声明 schema，需修正 → 这正是预期收益。

**复杂度**：M

---

### 5.2 S3.2 — `emit-event` 加 cost 字段

**Schema 扩展**：

```json
"cost": {
  "type": "object",
  "properties": {
    "tokens_in": { "type": "integer", "minimum": 0 },
    "tokens_out": { "type": "integer", "minimum": 0 },
    "model": { "type": "string" },
    "retries": { "type": "integer", "minimum": 0 },
    "duration_ms": { "type": "integer", "minimum": 0 }
  }
}
```

**调用方负责传**（Ritsu runtime 不能直接拿到 LLM 调用的 token 数）。Skills 在调用 emit-event 时附带。

**CLI 集成**：`ritsu export` 输出加 `Total Tokens` 列。

**复杂度**：S

---

### 5.3 S3.3 — `read-ctx` compact 真紧凑

**问题**：`handlers/read-ctx.ts:358` 即使 `detail=false` 也调 `readAllEntries`，全量 JSON.parse 整个 ctx 文件。

**改动**：
```typescript
// read-ctx.ts 重构
const isDetail = !!params.detail;
const ctxStats = statSync(ctxPath);
const useTailRead = !isDetail && ctxStats.size > 256 * 1024;

const recentEntries = useTailRead
  ? readRecentEntries(root, 50)   // 已有的 tail-read 实现
  : readAllEntries(root);
```

**失败模式分析**：
- circuit_breaker 需要扫所有同 cid 的事件 → 在 tail-read 模式下回退到 readAllEntries 只针对**最后一个 failed 的 cid**
- failed_summary 在 compact 模式仅返回 `failed_count`（已实现）

**复杂度**：M

---

### 5.4 S3.4 — Handler 返回值改 `structuredContent`（可选）

MCP 1.x 支持 `content[].type = "json"` 的结构化返回。当前全部 `JSON.stringify` 包在 text 里，LLM 每次要二次 parse。

**改动范围**：所有 `textResult(JSON.stringify(...))` 调用 → 检测 MCP client 能力后改为 `jsonResult(...)`。

**复杂度**：M
**优先级**：低（可推迟到 Phase 1.5）

---

## 6. 依赖与顺序

```
S1.1 版本号统一 ─┬─► S1.2 dist 清理
                 └─► S1.3 skill 集合统一 ─► S1.4 AGENTS.md block ─► S1.5 文案清理
                                                                          │
                                                                          ▼
                                                                E1 完成（freeze v5.3.0）
                                                                          │
                          ┌───────────────────────────────────────────────┤
                          ▼                                               ▼
S2.1 policy_check handler                          S3.1 output_schema 校验
S2.2 detector schema 扩展                          S3.2 cost 字段
S2.3 5 条政策实现                                  S3.3 tail-read
S2.4 violation event ─► E2 完成                    S3.4 structuredContent (可选) ─► E3 完成
                          │                                              │
                          └──────────────► v5.4.0 ◄─────────────────────┘
                                              │
                                              ▼
                                    准备进入 Phase 2 (v6.0)
```

---

## 7. 月度里程碑

| Month | 里程碑 | 输出 |
| --- | --- | --- |
| M1 | E1 完成 | v5.3.0 发布；`ritsu doctor` 零警告 |
| M2 | S2.1 + S2.2 落地 | policy_check handler 接口稳定 |
| M3 | S2.3 完成 5 条政策 + S2.4 | violation 事件能写入 ctx |
| M4 | E2 完成 | v5.4.0-rc 发布；Ritsu 自身通过自己的红线 |
| M5 | S3.1 + S3.2 + S3.3 | output_schema 校验、cost 记录、tail-read 上线 |
| M6 | E3 完成 + Phase 2 RFC 定稿 | v5.4.0 正式发布；准备切 v6.0 |

---

## 8. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| dist/ 退出 git 导致存量 PR 冲突 | 中 | 在主仓库公告冻结期；rebase 后再合 |
| `test` skill 删除引发使用者困惑 | 中 | CHANGELOG 显式标注；deprecation 期保留 schema 别名 1 个版本 |
| Policy engine 误报率高 | 高 | 初版只上线 5 条最稳的；每条上线前跑全量历史 ctx 回溯，调整 regex |
| output_schema 校验暴露存量 handler bug | 中 | 用 `RITSU_STRICT_OUTPUT=1` 环境变量开关，先 staging 后正式 |
| 多人协作冲突（policy.yaml 频繁改） | 低 | 加 CODEOWNERS 限定该文件审批人 |

---

## 9. 不在 Phase 1 范围内（明确推迟）

- ❌ Trace 协议（trace_id/span_id）— Phase 2
- ❌ AST 级 anti-pattern 检测（AP-2 unknown identifiers）— 等 Phase 1.5 决定是否引入 ts-morph
- ❌ 跨 session preferences 自动挖掘 — Phase 3
- ❌ Web UI / Dashboard
- ❌ `ritsu_complete_phase` facade tool — 等 trace 协议稳定后再做

---

## 10. 决策日志

| 日期 | 决策 | 理由 |
| --- | --- | --- |
| 2026-05-15 | 初版起草 | — |
| TBD | `test` skill 去/留 | 影响 S1.3 |
| TBD | 引入 ts-morph 与否 | 影响 AP-2 自动化深度 |
