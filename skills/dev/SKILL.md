---
name: dev
version: "3.0.0"
description: "Ritsu 领域自适应编码管道。防闭眼修改、未定义标识符拦截，按领域强制落地开发纪律。"
when_to_use: "/r-dev, 写代码, 开发, 修复 bug"
hard_constraints:
  - id: HC-1
    rule: "任何外部标识符引用前，必须调用 ritsu_grep_identifier 验证其存在"
    severity: FATAL
  - id: HC-2
    rule: "交付物不得包含 TODO/待定/后续完善 等占位符"
    severity: FATAL
  - id: HC-3
    rule: "不得修改 Handoff 实施清单范围之外的内容"
    severity: WARN
---

# Dev: 领域严苛的纯净编码 (Adaptive Implementation)

## ⚡ 执行前必读
| ID | 约束 | 违反后果 |
|----|------|---------|
| HC-1 | 标识符引用前必须 grep 验证 | 终止交付 |
| HC-2 | 不得有任何占位符 | 终止交付 |
| HC-3 | 不超出 Handoff 范围 | 警告，在摘要中标注 |

---

**触发条件**：用户输入 `/r-dev`。

## 执行流水线

### 1. 领域解析与 Handoff 溯源
> 引用 `_shared/domain-resolver.md`，输出 `[RITSU_CTX: domain={value}]`

调用 **`ritsu_list_artifacts`**（type=handoff）：
- **单个文件** → 读取，严格按实施清单执行
- **多个文件** → 列出文件名+修改时间，默认最新，告知用户可指定其他
- **用户已指定文件** → 直接读取指定文件
- **无文件** → 继续执行，在交付摘要注明"无 Handoff 溯源（风险已知悉）"

写入 ctx.md（调用 **`ritsu_write_artifact`** type=ctx）：
```
{timestamp} | dev | domain={value} | started | none
```

### 2. 领域专属编码纪律

**backend**：事务边界（多表写必须包裹事务）/ 日志规范（禁止吞异常不打日志，改为：必须在 catch 块中先打日志再决定是否重抛）/ 资源释放（必须在 finally/defer 中释放连接）

**frontend**：重渲染控制（状态变更必须最小粒度，禁用全局状态，改为：必须将可共享状态隔离至最近公共祖先组件）/ 竞态（异步请求必须实现取消或防抖，在组件中使用 AbortController 或 cleanup 函数）/ 内存泄漏（全局监听必须在组件销毁钩子中注销）

**fullstack**：以上两套同时适用

**infra/data**：变更幂等性 / 最小权限 / 状态文件备份确认

### 3. 标识符验证（HC-1 执行协议）
调用任何外部模块的函数/变量/组件前，**按以下协议执行**：

```
调用 ritsu_grep_identifier({标识符}, {文件后缀})
  ✅ exists=true  → 记录 found_in 路径，方可引用
  ❌ exists=false → 停止编写该调用，输出：
    "标识符 '{名称}' 在项目中不存在。
     请确认：① 名称是否有拼写错误 ② 是否需要先在项目中定义它"
     等待用户指示，不自行补全
```

### 4. 测试先行
编写业务逻辑前，先写出验证手段：
- 单测用例（至少覆盖正常路径 + 一个边界 case）
- 或可执行的 `curl` / UI 验证步骤

### 5. 沙盒自查清单（按优先级）
- [ ] HC-1：所有外部标识符均已通过 `ritsu_grep_identifier` 验证
- [ ] HC-2：代码中无 TODO / 待定 / 后续完善 / 暂不处理
- [ ] 无孤儿引用，无未使用的残余变量

### 6. 质量门禁
调用 **`ritsu_run_quality_gates`**，等待结果：
- Lint ✅ + Test ✅ → 可以交付
- 任何 ❌ → 修复后重新执行，不允许带着失败交付

**交付摘要**（强制输出）：
```
## 律 (Ritsu) 开发落盘清单
- 涉及文件: {路径 + 改动概述}
- Handoff 溯源: ritsu/handoff-{slug}.md 或 无（风险已知悉）
- Lint: ✅/❌ | Test: ✅/❌
```

写入 ctx.md：
```
{timestamp} | dev | domain={value} | done | none
```

---

## ⛔ 尾部锚点
**HC-1 最终提醒**：交付前回看自查清单第一条——所有外部标识符是否全部经过 grep 验证？未验证的不允许出现在交付代码中。

## 关联流转
> 引用 `_shared/state-machine.md` — dev 完成引导语。
