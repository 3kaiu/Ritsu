---
name: test
version: "3.8.0"
description: "Ritsu 测试工程技能。测试策略制定 → 用例编写 → 执行验证 → 覆盖率分析。"
when_to_use: "/r-test, 写测试, 补测试, 测试覆盖, test, 单测, 集成测试"
total_steps: 5
fast_mode:
  skip_steps: [1, 4]
  skip_artifacts: true
  self_test: "ritsu_run_quality_gates"
  description: "跳过测试策略制定(1)和覆盖率分析(4)，直接编写用例+执行验证，不写产物"
hard_constraints:
  - id: HC-1
    rule: "ref AP-4: 测试代码不得修改被测业务代码"
    severity: FATAL
  - id: HC-2
    rule: "ref AP-6: 测试用例不得包含占位符"
    severity: FATAL
  - id: HC-3
    rule: "每个测试用例必须可独立运行，不依赖执行顺序"
    severity: FATAL
---

# Test: 测试工程 (Test Engineering)

**触发条件**：用户输入 `/r-test`。

## 执行流水线

### 1. 领域解析 + 测试策略

> 引用 `_shared/skill-common-steps.md` Step 1

`[Step 1 Complete]` 后确定测试策略：

**测试分层选择**（按领域）：

| 领域          | 优先测试层                                     | 次要测试层                       |
| ------------- | ---------------------------------------------- | -------------------------------- |
| **backend**   | 单元测试（Service/Util）+ 集成测试（API 端点） | E2E（关键业务链路）              |
| **frontend**  | 单元测试（Hook/Util）+ 组件测试（渲染+交互）   | E2E（核心用户流程）              |
| **fullstack** | 两侧均覆盖                                     | API 契约测试（前后端接口一致性） |
| **infra**     | Dry-run 验证（terraform plan）+ 策略检查       | 部署冒烟测试                     |
| **data**      | 数据质量断言 + 幂等性验证                      | 端到端 Pipeline 运行             |

**覆盖率目标**（从 `AGENTS.md` 读取，无则使用默认值）：

- 核心业务逻辑：≥80%
- 工具函数/纯函数：≥90%
- UI 组件：≥60%（侧重交互逻辑，非样式）

### 2. 测试目标识别

`[Step 1 Complete]` 后进入步骤 2。

调用 **`ritsu_get_diff`** 识别变更范围：

- **有 diff** → 针对 diff 中的变更文件编写/补充测试
- **有 handoff** → 针对 handoff 实施清单中涉及的文件编写测试
- **用户指定** → 针对指定模块编写测试

**已有测试检查**：

- 调用 `ritsu_exec` 扫描目标文件对应的测试文件是否存在
- 存在 → 读取现有测试，识别未覆盖的分支/路径
- 不存在 → 从零编写

### 3. 用例编写

`[Step 2 Complete]` 后进入步骤 3。

**用例编写纪律**（HC-3 执行协议）：

- 每个用例遵循 Arrange-Act-Assert 模式
- Mock/Stub 必须在测试内创建，不依赖全局状态
- 异步测试必须使用正确的 async/await 或 done 回调
- 测试数据使用 factory/builder 模式，禁止硬编码魔法值

**领域专属测试规则**：

按当前领域已加载的 `coding_disciplines` 和 `attack_vectors` 执行（`domains/_base.yaml` + `domains/{domain}.yaml`）。对每条 discipline 的 `rule` 字段编写对应测试用例，对每条 attack_vector 的 `check` 字段编写防御性测试。

### 4. 执行与验证

`[Step 3 Complete]` 后进入步骤 4。

调用 **`ritsu_run_quality_gates`** 执行测试：

- passed: true → 进入步骤 5
- passed: false → 查看 test.failures 定位失败用例，修复后重新执行

**覆盖率分析**：

调用 `ritsu_exec` 执行覆盖率命令（从 `AGENTS.md` 读取，无则使用 `npx jest --coverage` 或同等命令）：

- 达标 → 继续
- 未达标 → 识别未覆盖行/分支，补充用例后重新执行

### 5. 交付摘要

`[Step 4 Complete]` 后进入步骤 5。

> 引用 `_shared/skill-common-steps.md` Step 4（skill=test）

写入 ctx-{YYYY-MM}.jsonl：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=test, artifact=null）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=test）
