# Skill 公共步骤模板 v4.1.0

> 所有 `SKILL.md` 中重复出现的步骤，统一引用此模板。
> 目标：提供一致的“上下文感知”与“交付闭环”骨架。

---

## Step 0: 现场恢复与对账

在执行实质性动作前，先通过工具对齐当前任务进度。

### 0.1 现场对账
调用 `ritsu_read_ctx`：
- **断点识别**：查看 `breakpoint_summary` 和 `recommended_next_step`。
- **产物关联**：自动加载最近的 `design-sheet` (设计源) 或 `dev-report` (实现源)。
- **一致性校验**：通过 `reality_check` 确认磁盘产物是否与记录一致。

### 0.2 执行模式选择
根据任务规模选择：
- `quick`：单点修复、文档更新、简单查询。
- `standard`：常规需求开发、重构、深度调研。
- `critical`：核心架构变更、高风险迁移、多模块影响。

---

## Step 1: 领域解析与 Started 标记

按以下优先级解析领域，输出 `[RITSU_CTX: domain={value}]`：
1. 读取 `AGENTS.md` 的 `domain`。
2. 调用 `ritsu_get_changed_files`，使用 `domain_hint`。

领域确认后，调用 `ritsu_emit_event` 追加 started 事件。

---

## Step 2: 产物落盘与事件追加

### 2.1 产物写入
调用 `ritsu_write_artifact` 写入主产物。
主产物必须遵循 `_shared/artifact-templates.md` 规范。

### 2.2 事件追踪
每次关键产物写入或阶段结束时，追加 `artifact_written` 或 `done` 事件。

---

## Step 3: 强制流转引导

所有技能完成时，必须基于当前结论给出明确的“下一步”建议：
- 示例：`《设计单》已就绪。建议运行 /r-dev 开始实现。`
- 示例：`开发已完成。建议运行 /r-review 进行验收。`

---

## Step 4: 统一交付摘要

输出标准化摘要，减少用户的阅读成本。

```markdown
## 律 (Ritsu) {skill_name} 交付摘要
- 核心文件: {路径}
- 关联溯源: {关联的设计单/回执路径}
- 关键结论: {一句话描述核心产出}
- 下一步建议: {明确的指令建议}
```
