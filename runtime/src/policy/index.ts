import type { PolicyCheckContext, PolicyViolation, DetectorPlugin } from "./types.js";
import { loadPolicies } from "./loader.js";
import { RegexDetector } from "./detectors/regex.js";

import { CrossFileDetector } from "./detectors/cross-file.js";
import { ScopeDiffDetector } from "./detectors/scope-diff.js";
import { ContractCoverageDetector } from "./detectors/contract-coverage.js";
import { PreferenceLintDetector } from "./detectors/preference-lint.js";
import { AstGrepDetector } from "./detectors/ast-grep.js";

const detectors: Record<string, DetectorPlugin> = {
  regex: new RegexDetector(),
  cross_file: new CrossFileDetector(),
  scope_diff: new ScopeDiffDetector(),
  contract_coverage: new ContractCoverageDetector(),
  preference_lint: new PreferenceLintDetector(),
  ast_grep: new AstGrepDetector(),
};

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
          // check if target matches, assuming target is the file basename or path
          const matchTarget = !ex.when.target_file || (ctx.target && ctx.target.endsWith(ex.when.target_file));
          if (matchSkill && matchTarget) {
            exempted = true;
            break;
          }
        }
      }
    }
    if (exempted) continue;

    // 2. Run detector
    if (rule.detector) {
      if (!detectors[rule.detector.type]) {
        throw new Error(`Detector type '${rule.detector.type}' is not registered. Used in rule '${rule.id}'.`);
      }
      const detector = detectors[rule.detector.type];
      
      // If the detector target doesn't match the current action, skip
      // write_artifact -> artifact_content
      // commit_diff -> diff
      if (rule.detector.target === "artifact_content" && ctx.action !== "write_artifact") continue;
      if (rule.detector.target === "diff" && ctx.action !== "commit_diff") {
        if (rule.detector.type !== "ast_grep") continue;
      }

      const ruleViolations = detector.detect(rule, ctx);
      violations.push(...ruleViolations);
    }
  }

  // Filter blocked (fatal, hard_stop)
  const isBlocked = violations.some(v => v.severity === "fatal" || v.severity === "hard_stop");

  return {
    passed: !isBlocked,
    violations,
  };
}
