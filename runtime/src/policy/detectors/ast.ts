import {
  Identifier,
  Project,
  SourceFile,
  SyntaxKind,
  VariableDeclaration,
  ts,
} from "ts-morph";
import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";

const UNKNOWN_IDENTIFIER_DIAGNOSTIC_CODES = new Set([2304, 2552]);
const AMBIENT_GLOBALS_PATH = "/__ritsu_globals__.d.ts";
const AMBIENT_GLOBALS_SOURCE = `
declare const process: {
  env: Record<string, string | undefined>;
  cwd?: (...args: unknown[]) => string;
};
declare const Buffer: {
  from: (...args: unknown[]) => unknown;
  alloc?: (...args: unknown[]) => unknown;
};
declare const __dirname: string;
declare const __filename: string;
declare const module: unknown;
declare const exports: unknown;
declare const require: ((id: string) => unknown) & { resolve?: (id: string) => string };
declare const global: typeof globalThis;
declare const describe: (...args: unknown[]) => unknown;
declare const it: (...args: unknown[]) => unknown;
declare const test: (...args: unknown[]) => unknown;
declare const expect: (...args: unknown[]) => unknown;
declare const beforeEach: (...args: unknown[]) => unknown;
declare const afterEach: (...args: unknown[]) => unknown;
declare const beforeAll: (...args: unknown[]) => unknown;
declare const afterAll: (...args: unknown[]) => unknown;
declare const vi: Record<string, unknown>;
declare const jest: Record<string, unknown>;
declare const cy: Record<string, unknown>;
declare const Cypress: Record<string, unknown>;
declare function setImmediate(...args: unknown[]): unknown;
declare function clearImmediate(handle: unknown): void;
declare namespace JSX {
  interface IntrinsicElements {
    [elementName: string]: unknown;
  }
}
`;

function extractUnknownIdentifierName(message: string): string | null {
  const match = message.match(/Cannot find name '([^']+)'/);
  return match?.[1] ?? null;
}

export class ASTDetector implements DetectorPlugin {
  type = "ast" as const;
  private project: Project;

  constructor() {
    this.project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        allowJs: true,
        jsx: ts.JsxEmit.Preserve,
      },
    });
    this.project.createSourceFile(
      AMBIENT_GLOBALS_PATH,
      AMBIENT_GLOBALS_SOURCE,
      { overwrite: true },
    );
  }

  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    // Only apply if content or target is provided
    if (!ctx.content && !ctx.target) {
      return violations;
    }

    const content = ctx.content || "";
    const filePath = ctx.target || "temp.ts";

    // Skip non-TS/JS files for AST
    if (!filePath.endsWith(".ts") && !filePath.endsWith(".js") && !filePath.endsWith(".tsx") && !filePath.endsWith(".jsx")) {
      return violations;
    }

    try {
      const sourceFile = this.project.createSourceFile(filePath, content, { overwrite: true });

      if (rule.detector?.check_unused) {
        this.detectUnused(sourceFile, rule, violations);
      }

      if (rule.detector?.check_identifiers) {
        this.detectUnknownIdentifiers(sourceFile, rule, violations);
      }
      
      // Cleanup
      this.project.removeSourceFile(sourceFile);
    } catch {
      // If AST parsing fails, we skip (or return a warning)
    }

    return violations;
  }

  private detectUnused(
    sourceFile: SourceFile,
    rule: PolicyRule,
    violations: PolicyViolation[],
  ) {
    // Basic unused detection (simplified for MVP)
    const unused = sourceFile.getVariableDeclarations().filter((declaration: VariableDeclaration) => {
      const name = declaration.getName();
      const references = declaration.findReferencesAsNodes();
      return references.length === 0 && !name.startsWith("_");
    });

    for (const declaration of unused) {
      violations.push({
        rule_id: rule.id,
        severity: rule.severity,
        message: `Unused variable '${declaration.getName()}' detected via AST analysis.`,
        evidence: declaration.getName(),
        suggestion: `Remove unused variable or prefix with '_' if intentional.`,
      });
    }
  }

  private detectUnknownIdentifiers(
    sourceFile: SourceFile,
    rule: PolicyRule,
    violations: PolicyViolation[],
  ) {
    const diagnostics = sourceFile
      .getPreEmitDiagnostics()
      .filter((diagnostic) =>
        UNKNOWN_IDENTIFIER_DIAGNOSTIC_CODES.has(diagnostic.getCode()),
      );

    for (const diagnostic of diagnostics) {
      const identifier = extractUnknownIdentifierName(
        String(diagnostic.getMessageText()),
      );
      if (!identifier) continue;

      violations.push({
        rule_id: rule.id,
        severity: rule.severity,
        message: `Unknown identifier '${identifier}' detected.`,
        evidence: identifier,
        suggestion: `Verify that '${identifier}' exists and is imported or declared before use.`,
      });
    }

    const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier);
    const forbidden = Array.isArray(rule.detector?.forbidden_identifiers)
      ? rule.detector.forbidden_identifiers.filter(
          (identifier): identifier is string => typeof identifier === "string",
        )
      : [];

    for (const id of identifiers as Identifier[]) {
      if (forbidden.includes(id.getText())) {
        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: `Forbidden identifier '${id.getText()}' used.`,
          evidence: id.getText(),
          suggestion: `Replace with an approved identifier.`,
        });
      }
    }
  }
}
