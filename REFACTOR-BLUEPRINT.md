# Ritsu Refactor Blueprint

> Status: draft
> Scope: product architecture, module boundaries, migration plan

## 1. Why This Refactor Exists

Ritsu's direction is correct: it is converging from a bundle of skills into an AI delivery system with a single business-facing flow:

1. `intake`
2. `deliver`
3. `assure`

The current repository already reflects this direction in product language, but the implementation still carries three overlapping mental models:

- skill-first orchestration
- protocol-first governance
- advanced-tool-first enhancement

This creates four practical problems:

1. the user-facing model is simpler than the implementation model
2. the stable core is mixed with experimental capability
3. compatibility layers stay visible for too long
4. the system is stronger at engineering discipline than at business delivery flow

This blueprint defines the target shape of the system and a realistic migration path.

## 2. Product Principles

The refactor is driven by these product principles:

1. one visible main flow:
   - `intake`
   - `deliver`
   - `assure`
2. runtime reliability is more important than adding new tools
3. advanced capabilities are optional plugins, not default promises
4. primary artifacts outrank legacy evidence artifacts
5. business delivery outcomes matter more than framework completeness

## 3. Target Product Model

### 3.1 User-Facing Stages

Only these three stages should remain as first-class product concepts:

- `intake`
- `deliver`
- `assure`

Current compatibility names remain only as transport aliases:

- `route -> intake`
- `pipe -> deliver`
- `review -> assure`

Internal modules such as `think`, `dev`, `test`, and `hunt` remain implementation details inside `deliver`, not separate product entry points.

### 3.2 Modes

`deliver` continues to expose:

- `quick`
- `standard`
- `critical`

These are valuable because they map to real business tradeoffs:

- speed
- risk
- validation depth

## 4. Target Architecture

The system should be explicitly split into five layers.

### 4.1 Product Layer

Responsibilities:

- define the user journey
- define stage outputs
- define merge/deploy decision semantics

Modules:

- `intake`
- `deliver`
- `assure`

### 4.2 Orchestration Layer

Responsibilities:

- classify task type
- infer risk/mode
- choose the shortest safe execution path
- decide when to ask for clarification
- decide when to escalate or fall back

Target submodules:

- `task-classifier`
- `mode-selector`
- `delivery-planner`
- `assurance-decision-engine`

This layer should consume stable runtime tools, but it should not own filesystem, git, or schema parsing logic.

### 4.3 Stable Runtime Layer

Responsibilities:

- state IO
- artifact IO
- workspace evidence
- quality verification
- project configuration loading

Stable tools:

- `ritsu_read_ctx`
- `ritsu_write_artifact`
- `ritsu_list_artifacts`
- `ritsu_get_changed_files`
- `ritsu_get_diff`
- `ritsu_run_quality_gates`
- `ritsu_read_agents`
- `ritsu_emit_event`

This layer is the production core. It gets the highest test and compatibility priority.

### 4.4 Advanced Plugin Layer

Responsibilities:

- optional acceleration
- optional retrieval enhancement
- optional deeper static analysis

Advanced tools:

- `ritsu_contract_validate`
- `ritsu_build_kg`
- `ritsu_query_kg`
- `ritsu_semantic_index_build`
- `ritsu_semantic_search`
- `ritsu_semantic_graph_rerank`
- `ritsu_ts_check`
- `ritsu_ts_symbol_query`
- `ritsu_env_probe`
- `ritsu_sandbox_prepare`
- `ritsu_sandbox_exec`
- `ritsu_sandbox_cleanup`

These tools must be documented as:

- optional
- best-effort
- non-blocking unless explicitly enabled by policy

### 4.5 Protocol and Governance Layer

Responsibilities:

- state machine
- ctx schema
- artifact schema
- global rules

Files:

- `_shared/state-machine.yaml`
- `_shared/ctx-event-schema.json`
- `_shared/ctx-protocol.md`
- `_shared/artifact-schema.yaml`
- `rules/anti-patterns.yaml`

This layer should stabilize. It should not continue to grow aggressively unless a new rule removes real ambiguity from the delivery flow.

## 5. Target Artifact Model

### 5.1 Primary Artifacts

These are the only artifacts that should remain first-class in the main product flow:

- `intake-ticket`
- `delivery-report`
- `assurance-report`

### 5.2 New Primary Artifact To Add

Ritsu currently misses an explicit delivery planning artifact. Add:

- `delivery-plan`

Recommended minimum structure:

1. goal and scope
2. risk boundary
3. implementation steps
4. verification plan
5. rollback notes

### 5.3 Optional Release Artifact To Add

To close the business delivery loop, add:

- `release-advice`

Recommended minimum structure:

1. merge recommendation
2. deploy recommendation
3. rollout guidance
4. rollback condition
5. business impact summary

### 5.4 Legacy Artifacts

Legacy artifacts remain available only as evidence or compatibility output:

- `handoff`
- `diagnosis`
- `review-stamp`
- `optimize-report`

Their role should be:

- evidence
- debugging aid
- migration compatibility

They should no longer define the core product narrative.

## 6. What Stays, What Changes

### 6.1 Must Keep

- the `intake / deliver / assure` product model
- `quick / standard / critical`
- ctx persistence
- artifact persistence
- quality-gate execution
- project-level rules override loading
- schema contract tests

### 6.2 Must Downgrade

- Rust/WASM as a headline capability until it is actually wired into the runtime path
- semantic/KG features as optional plugins
- contract coverage heuristics as supporting signal, not canonical truth

### 6.3 Must Remove From Main Mental Model

- skill-first entry-point storytelling
- legacy artifact dominance
- permanent dual naming in user docs

## 7. Current Design Problems To Resolve

### 7.1 Naming Drift

Current examples:

- product uses `intake / deliver / assure`
- runtime and skills still use `route / pipe / review`
- AGENTS/domain enum uses `infra`
- domain file is `domains/infra.yaml`

Target rule:

- product naming is canonical
- compatibility naming is explicit and temporary

### 7.2 Stable vs Experimental Mixing

Current problem:

- stable runtime tools and advanced tools sit too close together in system narrative

Target rule:

- all docs, handlers, and future package boundaries should mark each capability as either:
  - `core-stable`
  - `advanced-plugin`
  - `experimental`

### 7.3 Governance Density

Current problem:

- protocol, schema, and rules are already dense

Target rule:

- add governance only when it reduces real ambiguity or real failure rate
- avoid adding schema/rule surface area just because it is architecturally neat

### 7.4 Business Flow Gap

Current problem:

- intake is mostly engineering intake
- assure is mostly engineering assurance

Target rule:

- business goal, acceptance criteria, rollout posture, and impact summary must become first-class outputs

## 8. Target Repository Shape

This is the desired medium-term structure, not an immediate rename-all operation.

```text
Ritsu/
├── product/
│   ├── intake/
│   ├── deliver/
│   └── assure/
├── runtime/
│   ├── core-stable/
│   ├── plugins-advanced/
│   ├── protocol/
│   └── tests/
├── _shared/
├── rules/
├── domains/
└── skills/        # compatibility layer during migration
```

Interpretation:

- `product/` owns stage semantics
- `runtime/core-stable/` owns production-safe tools
- `runtime/plugins-advanced/` owns optional capabilities
- `skills/` remains temporarily for compatibility and migration

## 9. Module Migration Map

### 9.1 Product Entry Migration

- `skills/route` -> future `product/intake`
- `skills/pipe` -> future `product/deliver`
- `skills/review` -> future `product/assure`

### 9.2 Internal Skill Migration

Keep internal skill docs for now, but reclassify them:

- `think` -> internal deliver design module
- `dev` -> internal implementation module
- `test` -> internal verification module
- `hunt` -> internal diagnosis module
- `refactor` -> delivery mode or task pattern, not top-level entry
- `optimize` -> delivery mode or task pattern, not top-level entry

### 9.3 Runtime Handler Reclassification

Move conceptually into three buckets:

#### Core Stable

- `emit-event`
- `read-ctx`
- `read-agents`
- `write-artifact`
- `list-artifacts`
- `exec` only if kept on a strict allowlist basis
- `get-changed-files`
- `get-diff`
- `run-quality-gates`

#### Advanced Plugin

- `contract-validate`
- `kg-build`
- `kg-query`
- `semantic-index-build`
- `semantic-search`
- `semantic-graph-rerank`
- `ts-check`
- `ts-symbol-query`
- `env-probe`
- `sandbox-*`

#### Deferred / Experimental

- Rust/WASM runtime acceleration until the JS path is actually replaced

## 10. Implementation Roadmap

### Milestone 1: Naming and Boundary Cleanup

Goal:

- reduce cognitive drift

Tasks:

1. make `intake / deliver / assure` the canonical names in all top-level docs
2. mark `route / pipe / review` as compatibility aliases only
3. resolve `infra` naming everywhere and keep `devops` only as descriptive wording when needed
4. update handler/runtime docs to label tools as `core-stable` or `advanced-plugin`

Exit criteria:

- a new user can understand the system without learning old names first

### Milestone 2: Stable Core Hardening

Goal:

- make the main delivery path production-safe

Tasks:

1. strengthen `ritsu_run_quality_gates`
   - add strict mode
   - distinguish `skipped` from `passed`
2. upgrade artifact validation
   - parse required sections structurally
   - stop relying on label presence only
3. keep schema contract tests for all core tool outputs
4. decide whether `ritsu_exec` remains in stable or is reduced to support-only usage

Exit criteria:

- main flow can run without relying on advanced plugins

### Milestone 3: Business Flow Completion

Goal:

- make Ritsu useful from business request to delivery advice

Tasks:

1. add `delivery-plan`
2. add `release-advice`
3. upgrade intake outputs with:
   - business goal
   - acceptance criteria
   - non-functional constraints
   - minimum clarification set
4. upgrade assure outputs with:
   - rollout guidance
   - rollback condition
   - business impact summary

Exit criteria:

- output is useful to both engineering and delivery stakeholders

### Milestone 4: Advanced Plugin Rationalization

Goal:

- keep only advanced capabilities that prove real value

Tasks:

1. assign maturity labels to each advanced tool:
   - `beta`
   - `experimental`
   - `internal`
2. define fallback behavior for each advanced tool
3. measure actual usage and benefit
4. remove or archive tools that do not improve the main flow

Exit criteria:

- advanced tools are additive, not confusing

### Milestone 5: Runtime Acceleration Decision

Goal:

- eliminate dead-end architecture

Tasks:

1. either wire Rust/WASM into the hot path
2. or demote it to an experimental track
3. align tests and protocol semantics across JS and Rust implementations

Exit criteria:

- no major capability is described as core unless it is truly in use

## 11. Decision Rules

Use these rules for future changes.

### Add A New Capability Only If

at least one of the following is true:

1. it improves stable completion rate
2. it reduces user clarification turns
3. it reduces review/assurance miss rate
4. it reduces recovery time after failure

### Do Not Add A New Capability If

all of the following are true:

1. it mostly improves architecture elegance
2. it introduces a new artifact, rule, or protocol surface
3. it does not measurably improve the main flow

## 12. Success Metrics

The refactor should be evaluated with operational metrics, not aesthetics.

Recommended metrics:

1. average clarification turns per task
2. delivery completion rate
3. assure pass rate on first attempt
4. percent of tasks completed using core-stable tools only
5. advanced plugin invocation rate
6. advanced plugin uplift versus fallback path
7. average recovery time after interrupted sessions

## 13. Immediate Next Actions

The next implementation pass should do only these things:

1. rename top-level narrative to stage-first everywhere
2. classify all runtime tools into `core-stable` or `advanced-plugin`
3. resolve domain naming drift
4. add strict semantics to quality gates
5. define `delivery-plan` and `release-advice` schemas before adding more advanced tooling

If these five actions are not complete, do not expand the protocol surface or add major new advanced tools.
