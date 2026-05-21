import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";
import { detectProjectRoot } from "../../project-root.js";

function checkVersionConsistency(root: string): Array<{ file: string; field: string; version: string }> {
  const results: Array<{ file: string; field: string; version: string }> = [];
  const candidates = [
    { path: resolve(root, "package.json"), label: "root" },
    { path: resolve(root, "runtime/package.json"), label: "runtime" },
  ];
  for (const { path, label } of candidates) {
    if (!existsSync(path)) continue;
    try {
      const pkg = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
      if (typeof pkg.ritsu_protocol_version === "string") {
        results.push({ file: label, field: "ritsu_protocol_version", version: pkg.ritsu_protocol_version });
      }
    } catch { /* skip */ }
  }
  return results;
}

export class CrossFileDetector implements DetectorPlugin {
  type = "cross_file" as const;

  detect(rule: PolicyRule, _ctx: PolicyCheckContext): PolicyViolation[] {
    const violations: PolicyViolation[] = [];

    try {
      const projectRoot = detectProjectRoot();
      const versions = checkVersionConsistency(projectRoot);
      const uniqueVersions = new Set(versions.map((v) => v.version));
      if (uniqueVersions.size > 1) {
        const evidence = versions.map((v) => `${v.file}: ${v.field}=${v.version}`).join(", ");
        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: `Version drift detected across files.`,
          evidence,
          suggestion: `Align ritsu_protocol_version in package.json files.`,
        });
      }
    } catch (error: unknown) {
      violations.push({
        rule_id: rule.id,
        severity: rule.severity,
        message: `Version consistency checker failed.`,
        evidence: error instanceof Error ? error.message : String(error),
        suggestion: `Check package.json version fields.`,
      });
    }

    return violations;
  }
}
