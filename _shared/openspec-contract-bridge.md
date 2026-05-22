# OpenSpec ↔ Ritsu Contract Bridge v8.0.0

> 机器可读映射：OpenSpec 负责长期规格叙事；Ritsu `design-sheet.contracts[]` 负责验收与 `contract_coverage` detector。

## 映射规则

| OpenSpec | Ritsu |
| --- | --- |
| `openspec/changes/<change-id>/proposal.md` | `ritsu_sync_openspec_contracts` 输入 |
| Requirement bullets / numbered goals | `contracts[].id` = `OS-<change-id>-<n>` |
| `openspec/changes/<change-id>/specs/` | `contracts[].test_file_hint` 默认指向 change 目录 |
| `/opsx:apply` 实施 | `/r-dev` + `dev-report` quality gates |
| `openspec archive` (review 后) | `auto-archive` hook on `span_closed` |

## 工作流

1. `/r-think` P2 → `openspec propose` → `ritsu_sync_openspec_contracts`
2. `/r-dev` 实现；`ritsu_preflight(stage=dev)` + `run_quality_gates`
3. `/r-review` 三方对账：`OS-*` contract ids ↔ 测试断言 ↔ assurance verdict
4. `close_span` → 可选 OpenSpec `archive`

## Contract ID 约定

- 前缀 `OS-` 表示来源于 OpenSpec，避免与手写 `C1` 冲突
- 同一 change 内序号单调递增
- review 时若 OpenSpec specs 更新，重新 `sync` 并 bump dev-report 引用

## 反模式

- ❌ 同时维护完整 OpenSpec proposal **和** 完整 Ritsu design-sheet 叙事
- ❌ 跳过 `sync` 直接 dev（contract_coverage 将无法对账）
