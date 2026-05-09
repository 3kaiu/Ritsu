---
name: dev
version: "3.4.0"
description: "Ritsu 领域自适应编码管道。防闭眼修改、未定义标识符拦截，按领域强制落地开发纪律。"
when_to_use: "/r-dev, 写代码, 开发, 修复 bug"
token_budget: 8000
total_steps: 7
required_sections: [coding_disciplines, attack_vectors]
hard_constraints:
  - id: HC-1
    rule: "外部标识符引用前必须调用 ritsu_grep_identifier 抓取上下文，并严格校验其【函数签名/参数类型】是否对齐"
    severity: FATAL
  - id: HC-2
    rule: "交付物不得包含 TODO/待定/后续完善 等占位符"
    severity: FATAL
  - id: HC-3
    rule: "不得修改 Handoff 实施清单范围之外的内容"
    severity: WARN
  - id: HC-4
    rule: "当实施清单超过 3 项时，严禁一次性全量输出代码。必须强制分块（每次≤2项），并在块间执行验证与用户确认"
    severity: FATAL
---

# Dev: 领域严苛的纯净编码 (Adaptive Implementation)

**触发条件**：用户输入 `/r-dev`。

## 执行流水线

### 1. 领域解析与零点击寻址 (Zero-Click Context Binding)

> 引用 `_shared/skill-common-steps.md` Step 1

`[Step 1 Complete]` 后进入步骤 2。

**隐式绑定优先**：首先检查当前 IDE（Cursor/Windsurf）是否已激活打开了任何 `handoff-*.md` 或 `diagnosis-*.md` 文件。

- **若有** → 直接将其认定为本次 `dev` 的执行目标，跳过询问！并在输出中注明"已根据 IDE 焦点自动锁定目标文件"。

若未发现 IDE 焦点文件，则调用 **`ritsu_list_artifacts`**（type=handoff）：

- **单个文件** → 读取，严格按实施清单执行
- **多个文件** → 列出文件名+修改时间，默认最新，告知用户可指定其他
- **用户已指定文件** → 直接读取指定文件
- **无文件** → 继续执行，在交付摘要注明"无 Handoff 溯源（风险已知悉）"

### 2. 领域专属编码纪律

**backend**：事务边界（多表写必须包裹事务）/ 日志规范（禁止吞异常不打日志，改为：必须在 catch 块中先打日志再决定是否重抛）/ 资源释放（必须在 finally/defer 中释放连接）

**frontend**：重渲染控制（状态变更必须最小粒度，禁用全局状态，改为：必须将可共享状态隔离至最近公共祖先组件）/ 竞态（异步请求必须实现取消或防抖，在组件中使用 AbortController 或 cleanup 函数）/ 内存泄漏（全局监听必须在组件销毁钩子中注销）

**fullstack**：以上两套同时适用

**infra/data**：变更幂等性 / 最小权限 / 状态文件备份确认

### 3. 标识符验证（HC-1 执行协议）

`[Step 2 Complete]` 后进入步骤 3。

调用任何外部模块的函数/变量/组件前，**按以下协议执行（签名级校验）**：

```
1. 调用 ritsu_grep_identifier({标识符}, {文件后缀})
2. ✅ exists=true  → 必须阅读返回的 context 字段：
   - 提取该标识符的【函数签名/参数定义/类型说明】
   - 检查自己的调用代码是否与该签名严格对齐（参数顺序、对象结构、必填项）
   - 若签名与预期不符，严禁盲目猜测，必须修正自己的调用逻辑或询问用户
3. ❌ exists=false → 停止编写该调用，输出错误提示并等待指示
```

### 4. 降维分块执行与测试先行 (Chunked Execution)

`[Step 3 Complete]` 后进入步骤 4。

分析需要实现的任务清单总数：

- **若清单项 ≤ 3**：可全量执行，但在编写业务逻辑前，先写出验证手段（单测用例、curl 或 UI 验证步骤）。
- **若清单项 > 3**（触发 HC-4 强制约束）：
  1. **截断**：仅选取前 1-2 项核心逻辑执行。
  2. **验证**：调用 `ritsu_run_quality_gates` 跑通当前的 Lint/Test。
  3. **断点确认**：输出 `[暂停点]` 总结当前进度，明确询问用户："第一批次已无损跑通，是否继续下一批次？" 严禁一次性输出所有代码导致幻觉翻车。

### 5. 沙盒自查清单（按优先级）

`[Step 4 Complete]` 后进入步骤 5。

- [ ] HC-1：所有外部标识符均已通过 `ritsu_grep_identifier` 验证
- [ ] HC-2：代码中无 TODO / 待定 / 后续完善 / 暂不处理
- [ ] 无孤儿引用，无未使用的残余变量

### 6. 质量门禁

`[Step 5 Complete]` 后进入步骤 6。

调用 **`ritsu_run_quality_gates`**，等待结果：

- Lint ✅ + Test ✅ → 可以交付
- 任何 ❌ → 修复后重新执行，不允许带着失败交付

### 7. Handoff 契约自愈 (Handoff Drift Prevention)

`[Step 6 Complete]` 后进入步骤 7。

必须防止代码与设计文档发生割裂。

- 对比最终落盘的代码与步骤 1 溯源到的 `handoff-*.md` 文件。
- 如果在 Bug 修复或需求变更过程中，**实际代码的逻辑、接口结构、或架构层级推翻了原 Handoff 的契约**：
  - 必须主动调用 `ritsu_write_artifact` 修改原 `handoff-*.md` 文件。
  - 在文件对应位置修改契约，并在末尾 `Changelog` 区块追加条目（格式：`- [{timestamp}] /r-dev: {变更摘要}（偏离原因：{why}）`），**禁止删除已有 Changelog 条目**，确保文档与代码保持绝对同构且变更可追溯。

**交付摘要**（强制输出）：

```
## 律 (Ritsu) 开发落盘清单
- 涉及文件: {路径 + 改动概述}
- Handoff 溯源: .ritsu/handoff-{slug}.md 或 无（风险已知悉）
- Lint: ✅/❌ | Test: ✅/❌
```

写入 ctx-{YYYY-MM}.jsonl：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=dev, artifact=null）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=dev）
