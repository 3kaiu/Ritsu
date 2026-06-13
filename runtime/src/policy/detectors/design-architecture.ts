import { existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";
import { getProjectRoot } from "../../handlers/_utils.js";

export class DesignArchitectureDetector implements DetectorPlugin {
  type = "design_architecture" as const;

  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    // This detector only runs when writing or evaluating design-sheet/design-brief artifacts
    const isDesignSheet = ctx.target?.includes("design-sheet") || ctx.target?.includes("design-brief");
    if (!isDesignSheet || !ctx.content) {
      return violations;
    }

    const content = ctx.content;
    const root = getProjectRoot();

    // Parse files from the design content
    const files = this.extractProposedFiles(content);

    if (rule.id === "DA-1") {
      // 1. DDD & Clean Architecture Layer Violation
      for (const f of files) {
        const lower = f.toLowerCase();
        // Domain layer files must not have infrastructure/api/http/db suffixes in their names (layer pollution)
        if (lower.includes("/domain/") || lower.includes("/entity/")) {
          if (
            lower.includes("db") ||
            lower.includes("sql") ||
            lower.includes("api") ||
            lower.includes("http") ||
            lower.includes("controller") ||
            lower.includes("cli")
          ) {
            violations.push({
              rule_id: rule.id,
              severity: rule.severity,
              message: `DDD Layer Violation: Domain file '${basename(f)}' contains infrastructure concepts ('db', 'api', etc.) in its name/path.`,
              evidence: f,
              suggestion: `Move '${f}' to infrastructure layer, or rename it to separate Domain concern from Infrastructure details.`,
            });
          }
        }
      }

      // Check for explicit domain imports/depends on infrastructure statements in text
      const domainDependsOnInfraRegex = /domain\s+(?:calls|depends\s+on|imports|queries)\s+infrastructure/i;
      const entityDependsOnRepositoryRegex = /entity\s+(?:calls|queries|depends\s+on)\s+repository/i;
      if (domainDependsOnInfraRegex.test(content) || entityDependsOnRepositoryRegex.test(content)) {
        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: "Clean Architecture Violation: Design documentation suggests Domain layer depends directly on Infrastructure layer.",
          evidence: "Explicit dependency statement in design description.",
          suggestion: "Invert the dependency: define interfaces in the Domain layer and implement them in the Infrastructure layer.",
        });
      }
    }

    if (rule.id === "DA-2") {
      // 2. Generic Utility Sprawl
      const genericNames = ["utils.ts", "helper.ts", "helpers.ts", "common.ts", "shared.ts"];
      for (const f of files) {
        const base = basename(f);
        if (genericNames.includes(base)) {
          // If it is in the root src directory or not in a specific sub-domain
          const relative = f.replace(root, "").replace(/^\//, "");
          const isGenericPath = relative.startsWith("src/" + base) || relative.startsWith("runtime/src/" + base);
          if (isGenericPath) {
            violations.push({
              rule_id: rule.id,
              severity: rule.severity,
              message: `Generic Utility Sprawl: Avoid creating generic top-level '${base}'. Group helpers into cohesive domain services.`,
              evidence: f,
              suggestion: `Combine functions into a specific domain helper (e.g. 'auth-validator.ts') or reuse existing shared utilities.`,
            });
          }
        }
      }
    }

    if (rule.id === "DA-3") {
      // 3. Micro-File Sprawl
      const dirGroups: Record<string, string[]> = {};
      for (const f of files) {
        const dir = dirname(f);
        if (!dirGroups[dir]) dirGroups[dir] = [];
        dirGroups[dir].push(f);
      }

      for (const [dir, dirFiles] of Object.entries(dirGroups)) {
        // If proposing more than 5 files in the same directory, flag for consolidation
        if (dirFiles.length > 5) {
          violations.push({
            rule_id: rule.id,
            severity: rule.severity,
            message: `Micro-File Sprawl: Design proposes ${dirFiles.length} new/modified files in directory '${dir}'. Consider consolidating into cohesive modules.`,
            evidence: dir,
            suggestion: "Group similar interfaces/constants together into single domain files rather than sprawling single-line files.",
          });
        }
      }
    }

    if (rule.id === "DA-4") {
      // 4. Dead Design Guard
      for (const f of files) {
        const base = basename(f);
        const nameWithoutExt = base.replace(/\.[^/.]+$/, "");
        
        // Skip common or existing configuration files, and test files (which are consumers themselves)
        if (base === "package.json" || base === "AGENTS.md" || base === "anti-patterns.yaml" || base.includes(".test.") || base.includes(".spec.")) {
          continue;
        }

        // Count occurrences of the filename in the design sheet
        const escapedName = nameWithoutExt.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
        const regex = new RegExp(escapedName, "gi");
        const matches = content.match(regex);
        
        // If it is only mentioned once (where it is defined in the proposed files list), it is orphaned
        if (matches && matches.length === 1) {
          violations.push({
            rule_id: rule.id,
            severity: rule.severity,
            message: `Dead Design Guard: Proposed file '${base}' has no defined consumer or client references in the design.`,
            evidence: f,
            suggestion: `Make sure '${base}' is linked in the 'contracts' table or described in the execution/verification plans.`,
          });
        }
      }
    }

    if (rule.id === "DA-5") {
      const bigORegex = /\bO\([1nkm\d\s\*\^log\+]+?\)/i;
      const hasBigO = bigORegex.test(content);
      const hasComparison = /vs|compare|alternative|choice|option|complexity/i.test(content);

      if (!hasBigO) {
        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: "Algorithmic Complexity Mismatch: Design sheet must analyze time and space complexities using Big-O notation (e.g., O(N), O(log N)).",
          evidence: "No Big-O notations found in design text.",
          suggestion: "Add a complexity section (Time/Space Complexity) specifying Big-O bounds for the proposed operations.",
        });
      }

      if (!hasComparison) {
        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: "Algorithmic Comparison Missing: Design sheet must compare at least two alternative algorithms or data structures.",
          evidence: "No comparative algorithm details found.",
          suggestion: "Evaluate alternative solutions (e.g., 'Array vs Hash Map' or 'DFS vs BFS') and explain the choice.",
        });
      }
    }

    if (rule.id === "DA-6") {
      const hasTradeoffMatrix = /trade-off|decision\s+matrix|折中|对比|matrix|pros\/cons/i.test(content);
      const hasAlternatives = /alternative|option\s+[a-b]|备用|备选|选择/i.test(content);

      if (!hasTradeoffMatrix || !hasAlternatives) {
        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: "Architectural Trade-off Matrix Missing: Design must evaluate alternative architectural patterns (e.g., REST vs Event-driven) with a Pros/Cons matrix.",
          evidence: "No architectural trade-off or alternative options sections found.",
          suggestion: "Add an 'Alternative Architectures' section containing a Markdown table or comparative list evaluating trade-offs.",
        });
      }
    }

    return violations;
  }

  private extractProposedFiles(content: string): string[] {
    const paths: string[] = [];
    const fileUrlRegex = /file:\/\/\/([^\s\)\#]+)/g;
    for (const match of content.matchAll(fileUrlRegex)) {
      paths.push(match[1]);
    }
    
    // Match relative paths like runtime/src/... or src/...
    const relPathRegex = /(?:^|\s)(runtime\/src\/[a-zA-Z0-9_\-\.\/]+|src\/[a-zA-Z0-9_\-\.\/]+|tests\/[a-zA-Z0-9_\-\.\/]+)/gm;
    for (const match of content.matchAll(relPathRegex)) {
      paths.push(match[1].trim());
    }
    return [...new Set(paths)];
  }
}
