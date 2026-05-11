---
name: document
version: "3.8.0"
description: "Ritsu 文档维护技能。API 文档生成、README 更新、CHANGELOG 维护、JSDoc/TSDoc 补充。"
when_to_use: "/r-doc, 写文档, 更新文档, API文档, CHANGELOG, README, JSDoc"
complexity_grading: true
context_window_guidance: 4000
total_steps: 4
required_sections: [coding_disciplines]
hard_constraints:
  - id: HC-1
    rule: "ref AP-2: 文档必须与代码实际行为一致，禁止描述不存在的功能或参数"
    severity: FATAL
  - id: HC-2
    rule: "ref AP-6: 文档内容不得包含占位符"
    severity: FATAL
  - id: HC-3
    rule: "不得修改业务代码，只修改文档文件（.md/.d.ts/JSDoc 注释）"
    severity: WARN
---

# Document: 文档维护 (Documentation Maintenance)

**触发条件**：用户输入 `/r-doc`。

## 执行流水线

### 1. 领域解析 + 文档目标识别

> 引用 `_shared/skill-common-steps.md` Step 1

`[Step 1 Complete]` 后确定文档目标：

| 触发关键词     | 文档目标                                            |
| -------------- | --------------------------------------------------- |
| API / 接口文档 | 生成/更新 API Reference（从代码注释或路由定义提取） |
| README         | 更新项目 README（安装方式、使用说明、架构说明）     |
| CHANGELOG      | 维护 CHANGELOG.md（按 conventional-changelog 格式） |
| JSDoc / TSDoc  | 补充函数/方法的文档注释                             |
| 通用           | 用户指定目标                                        |

### 2. 代码扫描与文档对账

`[Step 1 Complete]` 后进入步骤 2。

**API 文档**：

- 调用 `ritsu_exec` 扫描路由定义文件（如 `src/routes/`、`src/api/`）
- 提取端点路径、HTTP 方法、请求/响应类型
- 与现有 API 文档对账：标记新增/变更/废弃端点

**JSDoc/TSDoc**：

- 调用 `ritsu_exec` 扫描 export 的函数/类/接口
- 识别缺失文档注释的导出符号
- 识别与签名不一致的现有注释（参数名/类型不匹配）

**CHANGELOG**：

- 调用 `ritsu_get_diff` 获取最近变更
- 按类型分类：feat / fix / refactor / perf / chore
- 与现有 CHANGELOG 最新条目对账，避免重复

**README**：

- 读取当前 README，识别过时内容（版本号、安装命令、配置项）
- 调用 `ritsu_exec` 读取 `package.json`/`AGENTS.md` 获取最新值

### 3. 文档生成/更新

`[Step 2 Complete]` 后进入步骤 3。

**API 文档格式**：

```markdown
## {HTTP Method} {Path}

{描述}

**请求参数**：
| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |

**响应**：
| 字段 | 类型 | 说明 |
| --- | --- | --- |

**示例**：
\`\`\`json
{请求/响应示例}
\`\`\`
```

**CHANGELOG 格式**（conventional-changelog）：

```markdown
## [{version}] - {YYYY-MM-DD}

### feat

- {新增功能描述}

### fix

- {修复描述}

### refactor

- {重构描述}
```

**JSDoc/TSDoc 规范**：

- 函数：`@param` + `@returns` + `@throws`（如有）
- 类：`@constructor` + 属性类型注释
- 接口/类型：每个字段的 `/** 注释 */`
- 禁止生成空描述的注释（如 `@param name -`）

**HC-1 执行协议**：

- 每个文档描述的函数/参数/端点，必须通过 `ritsu_exec(grep)` 验证其在代码中存在
- 描述的行为必须与代码实际逻辑一致，禁止凭记忆编写

### 4. 交付摘要

`[Step 3 Complete]` 后进入步骤 4。

```markdown
## 律 (Ritsu) 文档落盘清单

- 文档类型: {API/README/CHANGELOG/JSDoc}
- 涉及文件: {新增/修改的文档文件路径}
- 新增条目: {N} 个
- 更新条目: {M} 个
- 废弃标记: {K} 个
```

写入 ctx-{YYYY-MM}.jsonl：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=document, artifact=null）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=document）
