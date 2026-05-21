---
paths:
  - runtime/src/policy/**
---

# Policy Engine Rules

- New detectors go in `runtime/src/policy/detectors/`
- User plugin detectors go in `<root>/rules/detectors/`
- Each detector must implement `DetectorPlugin` from `types.ts`
- Detector types are registered via `plugin-loader.ts` — no hardcoding
- Always call `evaluatePolicies` in write_artifact handlers before writing
