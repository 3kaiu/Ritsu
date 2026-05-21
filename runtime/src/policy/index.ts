import type { PolicyCheckContext, PolicyViolation } from "./types.js";
import { loadPolicies } from "./loader.js";
import { reconcilePreferences } from "./detectors/ast-grep-reconciler.js";
import { getDetector, clearPluginCache } from "./plugin-loader.js";

export { reconcilePreferences };
export { clearPluginCache };

export function evaluatePolicies(ctx: PolicyCheckContext): { passed: boolean; violations: PolicyViolation[] } {
  const rules = loadPolicies();
  const violations: PolicyViolation[] = [];

  for (const rule of rules) {
    // 1. Check exemptions
    let exempted = false;
    if (rule.exemption && Array.isArray(rule.exemption)) {
      for (const ex of rule.exemption) {
        if (ex.when) {
          const matchSkill = !ex.when.skill || ex.when.skill === ctx.context?.skill;
          const matchTarget = !ex.when.target_file || (ctx.target && ctx.target.endsWith(ex.when.target_file));
          if (matchSkill && matchTarget) {
            exempted = true;
            break;
          }
        }
      }
    }
    if (exempted) continue;

    // 2. Run detector (from plugin loader — supports user-defined plugins)
    if (rule.detector) {
      const detector = getDetector(rule.detector.type);
      if (!detector) {
        throw new Error(`Detector type '${rule.detector.type}' is not registered. Used in rule '${rule.id}'.`);
      }

      if (rule.detector.target === "artifact_content" && ctx.action !== "write_artifact") continue;
      if (rule.detector.target === "diff" && ctx.action !== "commit_diff") {
        if (rule.detector.type !== "ast_grep" && rule.detector.type !== "ast") continue;
      }

      const ruleViolations = detector.detect(rule, ctx);
      violations.push(...ruleViolations);
    }
  }

  for (const v of violations) {
    if (v.evidence && v.evidence.length > 200) v.evidence = v.evidence.slice(0, 200) + "...";
  }

  const isBlocked = violations.some(v => v.severity === "fatal" || v.severity === "hard_stop");

  return {
    passed: !isBlocked,
    violations,
  };
}
