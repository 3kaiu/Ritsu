---
paths:
  - runtime/src/policy/**
---

# Policy Engine Rules

- New detectors go in `runtime/src/policy/detectors/`
- User plugin detectors go in `<root>/rules/detectors/`
- Each detector must implement `DetectorPlugin` from `types.ts`
- Detector types (11 built-in): regex, cross_file, scope_diff, contract_coverage, contract_drift, preference_lint, ast_grep, ast, codegraph, architecture, security_smell
- Detectors are registered via `plugin-loader.ts` — no hardcoding
- Always call `evaluatePolicies` in write_artifact handlers before writing
- New additions: blast-radius.ts (transitive BFS), import-graph.ts (symbol-level fallback)
