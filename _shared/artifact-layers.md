# 产物分层说明 v3.8.0

> 本文件定义 Ritsu 产物的产品层级，避免主链路产物和 legacy 过程证据混在一个层级被使用。

---

## Layer 1: 主链路产物

这些产物直接对应 `intake / deliver / assure`，或服务于其主链路决策，应优先成为产品心智和默认落盘目标。

### `intake-ticket`

- 所属阶段：`intake`
- 作用：记录需求理解、风险分级、执行路径
- 是否主链路默认产物：是

### `delivery-plan`

- 所属阶段：`deliver`
- 作用：记录目标范围、实施步骤、验证计划、回滚说明
- 是否主链路默认产物：是

### `delivery-report`

- 所属阶段：`deliver`
- 作用：记录本次交付结果、验证结果、已知风险、下一步
- 是否主链路默认产物：是

### `assurance-report`

- 所属阶段：`assure`
- 作用：记录是否可合并、是否可上线、阻断项、剩余风险
- 是否主链路默认产物：是

### `release-advice`

- 所属阶段：`assure`
- 作用：记录发布建议、灰度建议、回滚条件、业务影响摘要
- 是否主链路默认产物：是

---

## Layer 2: 过程证据产物

这些产物仍然重要，但它们服务于主链路，不应替代主链路产物成为默认最终输出。

### `handoff`

- 所属阶段：`deliver` 内部设计阶段
- 作用：补充实施边界、契约细化、任务拆解
- 典型来源：`think`
- 定位：实施契约，不是需求受理单，也不是交付回执

### `diagnosis`

- 所属阶段：`deliver` / `assure` 的诊断支路
- 作用：沉淀根因分析、证据链、复现步骤
- 典型来源：`hunt`
- 定位：问题诊断证据，不是最终交付结论

### `optimize-report`

- 所属阶段：`deliver` 的优化模式
- 作用：记录减法优化、性能或结构收敛的执行结果
- 典型来源：`optimize`
- 定位：专项优化报告，不替代标准 `delivery-report`

---

## Layer 3: 兼容镜像产物

这些产物主要为旧调用方、旧技能描述或旧消费链路保留，不应继续作为新产品语义的首选。

### `review-stamp`

- 所属阶段：`assure` 兼容层
- 作用：为 legacy 流程保留简化验收镜像
- 典型来源：`review`
- 定位：兼容镜像；新主链路应优先写 `assurance-report`

---

## 使用原则

1. 主链路完成后，优先检查是否已生成 `intake-ticket / delivery-plan / delivery-report / assurance-report`；若需要明确发布姿态，再检查 `release-advice`
2. 默认读取、检索、排序顺序也应先消费 `primary`，不足时再扩展到 `evidence` 和 `compatibility`
3. `handoff / diagnosis / optimize-report` 用于补充过程信息，不应替代主链路结论
4. `review-stamp` 仅在下游仍依赖 legacy 产物时保留
5. 若文档、工具说明或技能定义调整产物角色，必须同步：
   - `_shared/artifact-schema.yaml`
   - `_shared/artifact-templates.md`
   - `_shared/mcp-tools.yaml`
   - `README.md`
   - `runtime/README.md`
