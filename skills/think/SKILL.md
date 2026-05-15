---
name: think
version: "5.2.0"
description: "Ritsu 需求分析入口。根据任务等级产出对应深度的设计文档。"
when_to_use: "/r-think, 需求审核, 方案判断, 怎么做, 看看这个需求"
total_steps: 4
---

# Think: 自适应需求分析与设计

**触发条件**：用户输入 `/r-think`，或自动路由判定为需要设计的任务。

## 执行流水线

### 0. 分级判定

> 引用 `_shared/skill-common-steps.md` Step 0

- **Micro (P0)**: 告知用户"该任务无需设计，建议直接 `/r-dev`"。结束。
- **Standard (P1)**: 进入轻量分析路径。
- **Critical (P2)**: 进入深度分析路径。

---

### 🟡 Standard 路径 (P1)

1. **技术栈感知**: 通过 `ritsu_read_agents` 识别领域和倾向性。
2. **轻量工程分析**: 确认目标、关键改动点、实施步骤，评估是否涉及公共 API 变更。
3. **产出 `design-brief`**: 使用轻量模板，包含目标 + 关键改动 + 实施清单 + 验证。
4. **引导**: "设计简报已就绪。建议运行 `/r-dev` 开始实现。"

---

### 🔴 Critical 路径 (P2)

1. **现状加载与对账**: `ritsu_read_ctx` + 断点识别。
2. **技术栈感知与倾向性识别**: 通过 `ritsu_read_agents` 和文件扫描，识别领域人格。
3. **深度架构与工程化审查 (Engineering Audit)**:
   - **目标与核心链路分析**: 确认交付状态。
   - **领域专项审查**:
     - **通用**: 检查 API 向后兼容性、错误处理、资源释放逻辑。
     - **Frontend**: 评估重渲染风险、异步竞态管理、CSS 模块化。
     - **Backend**: 评估数据库事务、N+1 查询、接口幂等性、SQL 注入风险。
     - **Mobile**: 检查内存泄漏 (dispose)、列表虚拟化、离线降级方案。
   - **架构侵入度评估**: 识别受影响的上下游模块。
4. **产出完整 `design-sheet`**: 包含全部架构维度（方案范围、核心契约、实施清单、验证计划）。
5. **Multi-Agent 协调 (按需)**: 如果任务需拆分为多个独立工单（Multi-Agent），调用 `ritsu_write_artifact` 创建 `coordination-sheet`，并指导后续 Agent 执行对应的子 Span。
6. **引导**: "架构设计已就绪。建议运行 `/r-dev` 开始实现。"
