import ts from "typescript";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";
import { getProjectRoot } from "../../handlers/_utils.js";

const SAFE_GLOBALS = new Set([
  // Node / JS Globals
  "console", "process", "global", "globalThis", "Buffer", "module", "exports", "require",
  "__dirname", "__filename", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "setImmediate", "clearImmediate", "URL", "URLSearchParams",
  "Promise", "Map", "Set", "WeakMap", "WeakSet", "Headers", "Request", "Response", "fetch",
  "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError",
  "Math", "JSON", "Date", "RegExp", "Array", "Object", "String", "Number", "Boolean", "Symbol",
  "NaN", "Infinity", "undefined", "Intl", "Proxy", "Reflect",
  // Common testing libraries (Vitest, Jest)
  "describe", "it", "test", "expect", "beforeEach", "afterEach", "beforeAll", "afterAll", "vitest", "vi",
  // Common browser/DOM
  "window", "document", "navigator", "location", "history", "screen", "alert", "confirm", "prompt",
  "localStorage", "sessionStorage", "Blob", "File", "FormData",
]);

export class AstDetector implements DetectorPlugin {
  type = "ast" as const;

  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
    const root = getProjectRoot();
    const scanFiles = ctx.context?.scan_files?.length
      ? ctx.context.scan_files
      : ctx.context?.in_scope_files;

    if (!scanFiles?.length) return [];

    // Filter to only TypeScript and JavaScript files that actually exist
    const existingFiles = scanFiles
      .map((f) => resolve(root, f))
      .filter((abs) => existsSync(abs) && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(abs));

    if (existingFiles.length === 0) return [];

    const violations: PolicyViolation[] = [];

    try {
      // Create a TypeScript program for the target files
      const program = ts.createProgram(existingFiles, {
        noEmit: true,
        allowJs: true,
        checkJs: true,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.CommonJS,
        skipLibCheck: true,
      });

      // Fetch all diagnostics
      const diagnostics = ts.getPreEmitDiagnostics(program);

      for (const diagnostic of diagnostics) {
        if (!diagnostic.file) continue;

        // Ensure we only look at errors within our target scan files to avoid global/dependency noises
        const fileAbs = resolve(diagnostic.file.fileName);
        if (!existingFiles.some(f => resolve(f) === fileAbs)) continue;

        const code = diagnostic.code;
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");

        // We target:
        // - Syntactic errors (syntax errors) which block compiling completely
        // - Cannot find name (semantic error code 2304 / 2552) for unrecognized identifiers
        const isSyntactic = code >= 1000 && code < 2000;
        const isCannotFindName = code === 2304 || code === 2552;

        if (!isSyntactic && !isCannotFindName) {
          continue;
        }

        // For cannot find name, check if it's a known safe global
        if (isCannotFindName) {
          const cannotFindMatch = message.match(/Cannot find name ['"]([^'"]+)['"]/);
          if (cannotFindMatch) {
            const varName = cannotFindMatch[1];
            if (SAFE_GLOBALS.has(varName)) {
              continue;
            }
          }
        }

        const start = diagnostic.start ?? 0;
        const { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, start);
        const fileRel = diagnostic.file.fileName.replace(root + "/", "");

        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: `TypeScript Compilation AST Error: ${message}`,
          evidence: `${fileRel}:${line + 1}:${character + 1} - Code ${code}: ${message}`,
          suggestion: `Ensure the variable or function exists, or verify imports and declarations.`,
          confidence: 1.0,
        });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      violations.push({
        rule_id: rule.id,
        severity: "warn",
        message: `TypeScript compiler AST check failed internally: ${errMsg}`,
        confidence: 0.5,
      });
    }

    return violations;
  }
}
