# Ritsu 演进路线图

## 战略定位

Ritsu 当前是 **Claude Code 上最完整的 AI 辅助交付治理引擎**。目标是演进为 **AI 编程时代的通用质量基础设施**——ESLint + CI + Code Review 平台，面向所有 AI 编码助手。

```
现在                          12个月                         24个月
├───────────────┼──────────────────────────────┼────────────────────────┤
│ Claude Code   │ 多主机 + 知识图谱 + Dashboard │ 多语言 + 策略市场 + CI │
│ 单人工具      │ 团队协作平台                  │ 企业级 AI 治理平台     │
└───────────────┴──────────────────────────────┴────────────────────────┘
```

**核心原则**：每一步演进向后兼容。MCP 工具 API 不变，新增能力不走破坏性变更。

---

## 路线 1：解耦 Claude Code → 通用 AI 治理层 🔴

**目标**：让 Ritsu 可以在 Cursor、Cline、GitHub Copilot 等所有 MCP 兼容主机中运行。

### 现状

核心 MCP 运行时已 100% 可移植——所有 24 个 handler 使用标准 `@modelcontextprotocol/sdk` 和 `StdioServerTransport`。`.cursor/mcp.json` 已存在，`HostProfile` 类型已定义 `claude-code | cursor | all`。

耦合仅在三处：
- **Skill Markdown 加载**：Claude Code 独有的 `.claude-plugin/` → 命令 机制，其他主机没有
- **安装引导默认值**：`bootstrap.ts` 默认 `claude-code`
- **3 阶段 Prompt 缓存协议**：Anthropic/DeepSeek 特定，对其他主机是噪声

**已实施（v8.9.0）**：
- **替代加载机制 (1c)**：实现了 `syncLoopInstructionsToIDE` 规则同步引擎，动态将 Ritsu 核心规则同步生成 Cursor 规则（`.cursor/rules/ritsu-loop.mdc`）、Claude Code 规则（`.claude/rules/ritsu-loop.md`）以及 `AGENTS.md` 主机规则，解除对 Claude Code 独有加载机制的强耦合。

### 路线

| 阶段 | 内容 | 规模 |
|------|------|------|
| 1a | 主机抽象层：提取 `host-profiles/` 模块，每种 IDE 一个 profile，`--host auto` 自动检测 | 小（2-3 天） |
| 1b | Skill 内容通用化：拆分工作流逻辑与主机说明，缓存协议改为"推荐" | 小（1-2 天） |
| 1c | [已完成] 替代加载机制：将 SKILL.md 编译为 Cursor rules / Cline rules / Copilot instructions | 中（1 周） |

---

## 路线 2：团队/企业级平台 🔴

**目标**：从单人工具演进为团队协作平台，建立商业化基础。

### 现状

已有文件租约、任务声明、Agent 状态查询、HMAC 签名审计。数据采集完备——每个事件含 `agent.id`、`span_id`、`trace_id`、`cost.tokens_in/out`、`duration_ms`。

关键缺口：租约无心跳续约、任务声明永不过期、Agent 身份为自报字符串、无语义锁（读/写锁）。

### 路线

| 阶段 | 内容 | 规模 |
|------|------|------|
| 2a | 锁与声明加固：TTL 过期 + 显式心跳续约 + 读写锁类型区分 | 小（3-5 天） |
| 2b | 仪表板 API：轻量 HTTP 服务（Bun.serve），聚合现有 ctx 事件为 REST 端点 | 中（1-2 周） |
| 2c | RBAC 层：角色定义 + 权限检查 + Agent 身份绑定（公钥→签名→角色） | 中（1-2 周） |
| 2d | 企业功能（远期）：SSO、多项目聚合、合规报告（SOC2/ISO27001） | 大 |

---

## 路线 3：知识图谱 × 长期记忆 🔴

**目标**：统一当前 6 个知识孤岛，建立持久化项目知识图谱，形成数据飞轮护城河。

### 现状

8 个独立的知识组件，之间无交叉引用：

| 组件 | 持久化 | 问题 |
|------|--------|------|
| `import-graph.ts` 符号依赖图 | ❌ 仅内存 | 每次重建后丢弃 |
| `architecture-analyzer.ts` 架构指纹 | ⚠️ 每次重算 | 用正则而非 AST 提取导入 |
| `session-memory.ts` 跨会话记忆 | ✅ JSONL+向量 | 计算嵌入但从不索引向量 |
| `similar-violations.ts` 违规索引 | ✅ SQLite | 独立 tokenize 实现，重复 `similarity.ts` |
| `miner.ts` 偏好规则 | ✅ YAML | 仅 5 种启发式模式 |
| `quality-gates.ts` 质量门禁 | ⚠️ 仅最新快照 | 无历史趋势 |
| `analytics.ts` 行为分析 | ✅ SQLite 查询 | 仅 batch 聚合，无实时 |
| `context-lifecycle.ts` 检查点 | ✅ JSON | 无跨项目共享 |
| `test-intelligence.ts` 测试质量 | ❌ 无持久化 | 每次重算 |

重复逻辑：`blast-radius.ts` 和 `import-graph.ts` 各自实现相同的导入解析函数。

**已实施（v8.1.0 / v8.9.0）**：
- `context-lifecycle.ts` 检查点系统：结构化会话恢复
- `analytics.ts` 聚合引擎：质量趋势 + 成本分解 + 违规排名
- **修复记忆系统 (3b)**：修复了 `session-memory.ts` 中的向量数据库索引 Bug（将 `computeSimpleEmbedding` 替换为 `indexViolationEmbedding` 写入真实向量库），实现 `compactMemories` 自动规整日志限制到 500 条以内防止无限膨胀，实现 `queryBySkill` 的技能历史分类查询。

### 路线

| 阶段 | 内容 | 规模 |
|------|------|------|
| 3a | 统一依赖图并持久化：合并重复解析逻辑，写入 SQLite（files/symbols/deps 表），文件哈希变化时增量更新 | 中（1-2 周） |
| 3b | [已完成] 修复记忆系统：补全向量索引写入、消除重复 tokenize、记忆增加 file_refs/symbol_refs 链接 | 小（1-2 天） |
| 3c | 统一知识 API：单一查询接口回答"谁依赖这个符号""上次改这里出了什么问题""类似违规在哪" | 中（2-3 周） |
| 3d | 可选外部嵌入：RITSU_LLM_ENABLED 时使用 text-embedding-3-small 替代 128 维 n-gram 哈希 | 小（1 周） |
| 3e | 检查点+分析数据持久化上下文：合并 context-lifecycle 与 analytics 的存储层 | 小（2-3 天） |

---

## 路线 4：多语言扩展 🟡

**目标**：从 TypeScript 扩展到 Python、Go、Rust。

### 现状

语言无关层（25 个 MCP 工具、策略框架、质量门禁、regex detector）已就绪。受语言限制的仅 3 个组件：AST detector、codegraph detector、miner AST diff 分析。

### 路线

每加一个语言实现一个 `LanguageProvider` 接口（`parseFile` / `extractImports` / `extractExports` / `detectPatterns`），约 2-3 周/语言。

优先级：**Python**（AI/数据科学生态最大）→ **Go**（云原生/基础设施）→ **Rust**

---

## 路线 5：策略市场 + 社区生态 🟡

**目标**：建立 detector 和策略包的分发与发现机制，形成网络效应。

### 路线

| 阶段 | 内容 | 规模 |
|------|------|------|
| 5a | 策略包格式标准化：`ritsu-policy-pack/` 含 manifest.yaml + detectors + rules | 小（2-3 天） |
| 5b | 安装和发现：`ritsu policy search/install/list`，GitHub topic `ritsu-policy-pack` 作为注册中心 | 中（2-3 周） |

---

## 路线 6：CI/CD 全流程嵌入 🟢

**目标**：从 pre-commit hook 扩展到 PR checks、部署门禁、通知。

### 现状

`ritsu check --staged` 已就绪，策略引擎接受 `commit_diff` 上下文，输出为标准 linter 诊断格式。

**已实施（v8.1.0 / v8.9.0）**：
- `/r-deploy` Deploy Gate：完整的部署验证 Skill，覆盖回滚计划、灰度策略、监控方案、上线后验证
- `deploy-plan` 产物类型：结构化部署计划格式，包含 6 个必需章节
- `deploy-report` 产物类型：快速上线报告格式
- **Slack 与 GitHub Outbound 通信 (6c)**：实现了 `outbound-mcp.ts` 适配器，支持在 PR Review 等 Loop 执行过程中发送 Slack Webhook 进度通知、GitHub Commits 状态以及 PR 评论反馈，并支持优雅降级为本地日志输出。

### 路线

| 阶段 | 内容 | 规模 |
|------|------|------|
| 6a | GitHub Actions：`3kaiu/ritsu-action` 在 CI 中运行策略检查 | 小（2-3 天） |
| 6b | GitHub App：PR 自动评论违规 + 状态检查集成 | 中（2-3 周） |
| 6c | [已完成] Slack/Teams Webhook 通知 | 小（1-2 天） |

---

## 推荐时间线

```
第 1-3 个月  解耦 + 修复
  ├── 1a: 主机抽象层
  ├── 1b: Skill 内容通用化
  ├── 3b: 修复记忆索引 + 消除重复实现
  └── 3a: 统一依赖图持久化

第 3-6 个月  平台化基础
  ├── 2a: 锁与声明加固
  ├── 2b: 仪表板 API
  ├── 6a: GitHub Actions
  └── 5a: 策略包格式

第 6-12 个月  护城河深化
  ├── 3c: 统一知识图谱 API
  ├── 4: Python LanguageProvider
  └── 2c: RBAC 层

第 12-24 个月  生态扩展
  ├── 5b: 策略市场发现
  ├── 6b: GitHub App
  └── 2d: 企业功能
```

---

## 不改什么

- **MCP 工具 API 签名**：所有 25 个 handler 的输入/输出 schema 保持向后兼容
- **Skill 工作流逻辑**：think → dev → review → hunt 的协议不变，只适配不同主机
- **离线优先**：不引入新的外部服务依赖（SQLite + JSONL + YAML 持久化栈不变）
- **20 条 anti-patterns 语义**：hard-earned rules 不修改
- **现有测试**：90 个测试文件 / 589 个测试是基线

---

## 相关文档

- [CLAUDE.md](CLAUDE.md) — 引擎使用指南
- [CONTRIBUTING.md](CONTRIBUTING.md) — 贡献指南
- [CHANGELOG.md](CHANGELOG.md) — 版本历史
