---
name: hunt
version: "3.0.0"
description: "Ritsu 技术诊断引擎。抓证据 → 建 MECE 假设 → 验证 → 锁根因。绝对禁止改代码。"
when_to_use: "/r-hunt, 报错了, 排障, 诊断, debug, 找不到问题在哪"
hard_constraints:
  - id: HC-1
    rule: "确诊前禁止修改任何业务代码。发现修改冲动时，记录到诊断报告，等确诊后交给 /r-dev"
    severity: FATAL
  - id: HC-2
    rule: "假设必须 MECE（互斥穷举），每条假设必须有明确的排除条件"
    severity: FATAL
  - id: HC-3
    rule: "全部假设排除时，回到步骤 2 重新采集证据，禁止输出模糊猜测"
    severity: FATAL
---

# Hunt: 技术 CSI — 深度根因诊断 (Root Cause Investigation)

## ⚡ 执行前必读
| ID | 约束 | 违反后果 |
|----|------|---------|
| HC-1 | 确诊前不改代码 | 终止，交给 /r-dev |
| HC-2 | 假设必须 MECE + 排除条件 | 重新建立假设集 |
| HC-3 | 全部排除时重新采集，不猜测 | 终止模糊输出 |

---

**触发条件**：用户输入 `/r-hunt [问题描述]`，或由 `/r-triage` 携带结构化上下文路由。

## 执行流水线

### 1. 领域解析
> 引用 `_shared/domain-resolver.md`，输出 `[RITSU_CTX: domain={value}]`

写入 ctx-{YYYY-MM}.md（type=ctx）：
```
{timestamp} | hunt | domain={value} | started | none
```

### 2. 证据抓取
**frontend**：浏览器控制台完整堆栈 / 网络面板状态码+响应体 / DevTools 状态快照 / Hydration 特征 / CORS 响应头

**backend**：完整报错堆栈（含线程/goroutine 信息）/ DB 连接池状态 / 内存与 GC 曲线 / 上游服务响应延迟

**infra/data**：变更前后状态文件 diff / CI 日志完整输出 / 资源依赖图失败节点

### 3. 建立 MECE 假设（HC-2 执行协议）
提出 1-3 个假设，**每条必须满足**：
- **互斥**：假设 A 成立可排除 B（死锁 vs 连接池耗尽是两个独立原因，不是子集关系）
- **有排除条件**：明确说明哪个验证结果可以排除此假设

输出格式：
```
假设 #1（置信度：高）：由于 [具体原因]，导致 [现象]
  排除条件：执行 [命令/操作]，若输出 [X] 则此假设不成立

假设 #2（置信度：中）：由于 [具体原因]，导致 [现象]
  排除条件：执行 [命令/操作]，若输出 [Y] 则此假设不成立
```

**frontend 参考方向**：Service Worker 缓存过期 / 闭包捕获旧值 / 异步竞态（useEffect 时机）/ 三方库版本冲突

**backend 参考方向**：DB 死锁（SHOW ENGINE INNODB STATUS）/ 连接池耗尽（检查池配置与活跃数）/ OOM（内存趋势）/ 事务隔离级别（幻读/不可重复读）

### 4. 探针验证（按置信度从高到低）
逐个验证，每个假设验证后输出明确结论：
```
假设 #1 验证：执行了 [命令]，结果为 [...]
→ ✅ 确认：根因锁定，进入步骤 5
→ ❌ 排除：[排除理由]，推进假设 #2
```

**全部假设排除时（HC-3 执行协议）**：
```
输出：
  "已排除所有假设：
   - 假设 #1 排除：[理由]
   - 假设 #2 排除：[理由]
  需要更深层证据，请提供：[具体需要什么]"
等待用户补充后，回到步骤 2，不输出任何推测性结论。
```

### 5. 写入诊断报告
调用 **`ritsu_write_artifact`**（type=diagnosis），文件路径：`ritsu/diagnosis-{YYYYMMDD-HHMMSS}.md`

按 `_shared/artifact-schema.md` Schema 2 格式写入。

写入 ctx-{YYYY-MM}.md：
```
{timestamp} | hunt | domain={value} | done | ritsu/diagnosis-{ts}.md
```

---

## ⛔ 尾部锚点
**HC-1 最终提醒**：诊断报告写完后，检查自己在整个诊断过程中是否修改了任何业务文件。若有，立即撤销并在报告中记录。

## 关联流转
> 引用 `_shared/state-machine.md` — hunt 完成引导语。
