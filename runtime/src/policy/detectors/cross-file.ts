import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../../../");

export class CrossFileDetector implements DetectorPlugin {
  type = "cross_file" as const;

  detect(rule: PolicyRule, _ctx: PolicyCheckContext): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    
    // Only check if it's the right rule (or we can just run it generally for cross_file)
    try {
      // Run the version-check.js script
      execSync("node runtime/version-check.js", { cwd: projectRoot, encoding: "utf8", stdio: "pipe" });
    } catch (error: any) {
      // If it exits with non-zero, there is a version drift
      violations.push({
        rule_id: rule.id,
        severity: rule.severity,
        message: `Version drift detected across files.`,
        evidence: error.stderr || error.message,
        suggestion: `Run 'node runtime/version-check.js --write' to fix version drift.`
      });
    }

    return violations;
  }
}
