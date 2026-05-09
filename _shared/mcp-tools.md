# MCP Tool Schema 声明 (MCP Tools)
> Ritsu Bundle 共享协议 v3.0
> 所有技能中的工具调用必须引用此文件中声明的工具名，禁止用自然语言描述工具调用行为。
> AI 执行时应将此文件视为"可用工具菜单"，按 Schema 构造调用参数。

---

## 工具清单

### `ritsu_get_changed_files`
获取当前工作区和暂存区的所有变更文件。
```json
{
  "name": "ritsu_get_changed_files",
  "description": "同时检查 git 工作区（unstaged）和暂存区（staged）的变更文件列表，合并去重后返回",
  "commands": [
    "git diff --name-only",
    "git diff --name-only --cached"
  ],
  "returns": {
    "files": ["相对路径列表"],
    "extensions": ["去重后的文件后缀列表"]
  },
  "error_handling": {
    "not_a_git_repo": "告知用户当前目录不是 Git 仓库，跳过此工具，使用 P3 询问用户确定领域",
    "no_changes": "告知用户当前无变更文件，继续执行但在摘要中注明"
  }
}
```

---

### `ritsu_get_diff`
获取当前所有变更的完整 diff 内容（用于 review 阶段）。
```json
{
  "name": "ritsu_get_diff",
  "description": "获取工作区和暂存区的完整 diff，用于代码审查",
  "commands": [
    "git diff",
    "git diff --cached"
  ],
  "returns": {
    "diff_content": "完整 diff 文本"
  },
  "error_handling": {
    "not_a_git_repo": "告知用户，要求手动粘贴代码变更内容",
    "no_changes": "告知用户无变更，询问是否 review 特定文件"
  }
}
```

---

### `ritsu_grep_identifier`
验证标识符在项目中真实存在（dev 阶段最高红线工具）。
```json
{
  "name": "ritsu_grep_identifier",
  "description": "在项目文件中搜索指定标识符，验证其真实存在性",
  "input": {
    "identifier": "要验证的函数名/变量名/组件名",
    "extensions": "文件后缀列表，如 ['.go', '.ts']"
  },
  "command_template": "grep -r \"{identifier}\" . --include=\"*{ext}\" --exclude-dir={node_modules,.git,dist,build,out,vendor} -l",
  "returns": {
    "exists": "boolean",
    "found_in": ["找到该标识符的文件路径列表"]
  },
  "decision": {
    "exists=true": "可以引用该标识符",
    "exists=false": "停止引用，告知用户：该标识符在项目中不存在，请确认名称或先定义它"
  }
}
```

---

### `ritsu_run_quality_gates`
读取 AGENTS.md 并执行其中定义的 Lint 和 Test 命令。
```json
{
  "name": "ritsu_run_quality_gates",
  "description": "读取 AGENTS.md 中的质量门禁命令并依次执行",
  "steps": [
    "1. 读取 AGENTS.md 的 '质量门禁' 区块",
    "2. 提取 Lint 命令并执行",
    "3. 提取 Test 命令并执行"
  ],
  "returns": {
    "lint": { "passed": "boolean", "output": "执行输出摘要" },
    "test": { "passed": "boolean", "output": "执行输出摘要" }
  },
  "error_handling": {
    "agents_not_found": "告知用户 AGENTS.md 不存在，执行 /r-init 后再继续",
    "command_not_defined": "告知用户该命令标记为'待补充'，需先完善 AGENTS.md",
    "command_failed": "输出完整失败日志，停止交付，要求修复后重新执行"
  }
}
```

---

### `ritsu_write_artifact`
写入 Ritsu 产物文件（Handoff / Diagnosis / Review Stamp / ctx.md）。
```json
{
  "name": "ritsu_write_artifact",
  "description": "将产物内容写入 ritsu/ 目录下的指定文件，写入前进行 Schema 合规验证",
  "input": {
    "type": "handoff | diagnosis | review-stamp | ctx",
    "filename": "文件名（含路径）",
    "content": "文件内容（必须符合 artifact-schema.md 对应 Schema）"
  },
  "validation": "写入前检查内容是否包含 TODO/待定/暂不处理 等占位符，发现则拒绝写入并报错",
  "returns": {
    "path": "写入成功的完整文件路径",
    "size_bytes": "文件大小"
  }
}
```

---

### `ritsu_list_artifacts`
列举指定类型的所有 Ritsu 产物文件。
```json
{
  "name": "ritsu_list_artifacts",
  "description": "列举 ritsu/ 目录下指定类型的产物文件，按修改时间倒序排列",
  "input": {
    "type": "handoff | diagnosis | review-stamp | ctx | all"
  },
  "returns": {
    "files": [
      { "path": "文件路径", "modified": "YYYYMMDD-HHMMSS", "size_bytes": 0 }
    ]
  }
}
```

---

### `ritsu_read_ctx`
读取当前项目的任务上下文日志。
```json
{
  "name": "ritsu_read_ctx",
  "description": "读取 ritsu/ctx.md，解析最近的任务状态，用于会话恢复。⚠️ 必须使用 tail 机制（如 tail -n 20），仅截取最后 20 条记录，严禁全量加载引发上下文 Token 爆炸。",
  "returns": {
    "last_incomplete": "最后一条 started 但没有 done/failed 的记录，或 null",
    "last_completed": "最后一条 done 记录，或 null",
    "recent_entries": "最近 10 条记录列表"
  }
}
```
