---
name: hunt
version: "3.8.0"
description: "Ritsu 技术诊断引擎。抓证据 → 建 MECE 假设 → 验证 → 锁根因。绝对禁止改代码。"
when_to_use: "/r-hunt, 报错了, 排障, 诊断, debug, 找不到问题在哪"
total_steps: 6
fast_mode:
  skip_steps: [4]
  skip_artifacts: true
  self_test: null
  description: "跳过 MECE 假设(4)，直接 grep 报错信息+5-Whys 根因倒推，不写 diagnosis 产物"
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

**触发条件**：用户输入 `/r-hunt [问题描述]`，或由 `/r-triage` 携带结构化上下文路由。

> ⚡ **fast 模式**：`/r-hunt --fast` 或报错信息明确时自动触发。跳过 MECE 假设步骤，直接 grep 定位 + 5-Whys 根因倒推，不写 diagnosis 产物文件。

## 执行流水线

### 1. 领域解析

> 引用 `_shared/skill-common-steps.md` Step 1

### 2. 零点击上下文绑定 (Zero-Click Context Binding)

`[Step 1 Complete]` 后进入步骤 2。

**隐式绑定优先**：检查当前 IDE（Cursor/Windsurf）是否已激活打开了任何错误日志文件、Issue 描述文档或历史 `diagnosis-*.md` 文件。

- **若有** → 直接读取当前激活的焦点文件内容作为诊断的初始上下文，跳过向用户索要报错信息，并在输出中注明"已根据 IDE 焦点自动提取报错上下文"。

### 3. 证据抓取与边界扫描 (Boundary Scan)

`[Step 2 Complete]` 后进入步骤 3。

**系统边界定义**：在抓取具体日志前，强制输出当前报错涉及的【系统数据流链路】（例如：Client -> WAF -> Gateway -> Node.js -> Redis -> MySQL）。这能彻底消除大模型在局部盲区中瞎猜的现象。

根据边界定义抓取证据，按当前领域已加载的 `hypothesis_directions` 确定优先排查方向（`domains/_base.yaml` + `domains/{domain}.yaml`）。

### 4. 建立 MECE 假设（HC-2 执行协议）

`[Step 3 Complete]` 后进入步骤 4。

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

> 参考方向按当前领域已加载的 `hypothesis_directions`（`domains/_base.yaml` + `domains/{domain}.yaml`），LLM 必须结合项目实际情况调整，禁止原样照搬。

### 5. 探针验证（按置信度从高到低）

`[Step 4 Complete]` 后进入步骤 5。

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

### 6. 5-Whys 根因倒推与写入诊断报告

`[Step 5 Complete]` 后进入步骤 6。

在最终锁定问题后，严禁直接把"报错表象"当做根因。必须执行 **【5-Whys 连续追问】** 协议：

```
报错表象：[例如：变量为 undefined]
↳ 为什么？因为 [DB 返回为空]
  ↳ 为什么？因为 [外键关联失效]
    ↳ 为什么？因为 [上一版数据迁移遗漏了约束]
      ↳ 物理根因：[数据迁移脚本不完整]
```

基于 5-Whys 的最终结论，调用 **`ritsu_write_artifact`**（type=diagnosis）写入 md 文件：

- md 路径：`.ritsu/diagnosis-{YYYYMMDD-HHMMSS}.md`（Schema 2，AI 消费）

按 `_shared/artifact-schema.yaml` Schema 2 格式写入（将其中的 Root Cause 替换为 5-Whys 提炼的物理根因）。

**交付摘要**：

> 引用 `_shared/skill-common-steps.md` Step 4（skill=hunt）

写入 ctx-{YYYY-MM}.jsonl：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=hunt, artifact=.ritsu/diagnosis-{ts}.md）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=hunt）
