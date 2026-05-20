import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";
import { detectProjectRoot } from "../../project-root.js";
// @ts-expect-error version-check.js is an untyped external JS file
import { checkVersions } from "../../../version-check.js";

export class CrossFileDetector implements DetectorPlugin {
  type = "cross_file" as const;

  detect(rule: PolicyRule, _ctx: PolicyCheckContext): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    
    try {
      const projectRoot = detectProjectRoot();
      const { mismatches } = checkVersions(projectRoot, false);
      if (mismatches.length > 0) {
        const evidence = mismatches.map((m: { file: string; found: string; expected: string }) => `${m.file}: found ${m.found}, expected ${m.expected}`).join("\n");
        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: `Version drift detected across files.`,
          evidence,
          suggestion: `Run 'node runtime/version-check.js --write' to fix version drift.`,
        });
      }
    } catch (error: unknown) {
      violations.push({
        rule_id: rule.id,
        severity: rule.severity,
        message: `Version consistency checker failed to execute.`,
        evidence: error instanceof Error ? error.message : String(error),
        suggestion: `Check runtime/version-check.js or repository state.`,
      });
    }

    return violations;
  }
}
