# RFC-002: AST Detector Implementation Strategy

| | |
| --- | --- |
| **Status** | Approved |
| **Author** | Antigravity |
| **Created** | 2026-05-15 |
| **Target Version** | v6.0.0 |
| **Decision** | Use `ts-morph` for TypeScript specialization |

## 1. Background

Ritsu needs an AST (Abstract Syntax Tree) detector to perform deep structural checks that regular expressions cannot handle reliably. Key use cases include:
- Detecting unused variables (`AP-2`).
- Identifying unknown identifiers / broken references.
- Enforcing architectural patterns (e.g., "all handlers must import from `_utils.ts`").

## 2. Alternatives

### 2.1 `tree-sitter`
- **Pros**: Multi-language support (C, Go, Rust, Python, etc.). extremely fast.
- **Cons**: Requires native bindings (WASM or Node-GYP), harder to maintain in a simple Node.js runtime. Semantic analysis is limited without full type information.

### 2.2 `ts-morph` (Wrapper around TypeScript API)
- **Pros**: Deepest possible analysis for TypeScript (types, references, symbol table). Zero native dependencies (pure JS/TS).
- **Cons**: Limited to JS/TS. Higher memory usage for large projects.

## 3. Decision

We choose **`ts-morph`** for the following reasons:
1. **Strategic Focus**: Ritsu's own core and its primary target projects are currently TypeScript-heavy.
2. **Local-First & Portable**: `ts-morph` is easy to distribute via NPM without native build tools.
3. **Accuracy**: For `AP-2` (hallucinated identifiers), we need actual reference checking, which `ts-morph` provides out of the box via the TypeScript language service.

## 4. Implementation Details

- The `ASTDetector` will be registered in `policy/index.ts`.
- It will use an in-memory `Project` instance to analyze individual files or diff hunks.
- Future multi-language support can be added via a secondary `tree-sitter` detector if needed.
