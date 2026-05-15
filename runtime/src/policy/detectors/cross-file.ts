import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";

export class CrossFileDetector implements DetectorPlugin {
  type = "cross_file" as const;

  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
    // This is a placeholder for POL-004 Version drift logic.
    // Full logic will be implemented as needed.
    return [];
  }
}
