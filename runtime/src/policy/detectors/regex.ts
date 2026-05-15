import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";

export class RegexDetector implements DetectorPlugin {
  type = "regex" as const;

  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
    const config = rule.detector;
    if (!config || !config.patterns || !ctx.content) {
      return [];
    }

    const violations: PolicyViolation[] = [];

    for (const p of config.patterns) {
      const regex = new RegExp(p);
      const match = ctx.content.match(regex);
      if (match) {
        violations.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: `Content matched restricted pattern: ${p}`,
          evidence: match[0],
        });
      }
    }

    return violations;
  }
}
