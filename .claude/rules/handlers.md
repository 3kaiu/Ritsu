---
paths:
  - runtime/src/handlers/**
---

# Handler Rules

- Use `errorResult()` for simple text errors, `structuredError()` for machine-readable errors
- Use `textResult(JSON.stringify(...))` for success responses
- ALWAYS get project root via `getProjectRoot()` from `_utils.js`
- Never call `process.exit()` in handler code
- Validate params at the top of each handler — return early on invalid input
