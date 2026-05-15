import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";

export class ScopeDiffDetector implements DetectorPlugin {
  type = "scope_diff" as const;

  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
    // This is a placeholder for POL-005 Scope creep logic.
    return [];
  }
}
