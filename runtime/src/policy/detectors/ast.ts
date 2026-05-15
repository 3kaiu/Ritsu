import { Project, SyntaxKind } from "ts-morph";
import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";

export class ASTDetector implements DetectorPlugin {
  type = "ast" as const;
  private project: Project;

  constructor() {
    this.project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        allowJs: true,
      },
    });
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
    } catch (e) {
      // If AST parsing fails, we skip (or return a warning)
    }

    return violations;
  }

  private detectUnused(sourceFile: any, rule: PolicyRule, violations: PolicyViolation[]) {
    // Basic unused detection (simplified for MVP)
    const unused = sourceFile.getVariableDeclarations().filter((d: any) => {
      const name = d.getName();
      const references = d.findReferencesAsNodes();
      return references.length === 0 && !name.startsWith("_");
    });

    for (const d of unused) {
      violations.push({
        rule_id: rule.id,
        severity: rule.severity,
        message: `Unused variable '${d.getName()}' detected via AST analysis.`,
        evidence: d.getName(),
        suggestion: `Remove unused variable or prefix with '_' if intentional.`
      });
    }
  }

  private detectUnknownIdentifiers(sourceFile: any, rule: PolicyRule, violations: PolicyViolation[]) {
    // This is complex for a standalone detector without full project context
    // For now, we'll just check for a common anti-pattern: using 'TODO' or 'FIXME' as identifiers (hypothetical)
    // In a real scenario, this would check against a symbol table.
    const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier);
    const forbidden = rule.detector?.forbidden_identifiers || [];
    
    for (const id of identifiers) {
      if (forbidden.includes(id.getText())) {
        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: `Forbidden identifier '${id.getText()}' used.`,
          evidence: id.getText(),
          suggestion: `Replace with an approved identifier.`
        });
      }
    }
  }
}
