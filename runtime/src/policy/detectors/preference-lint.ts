import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";

export class PreferenceLintDetector implements DetectorPlugin {
  type = "preference_lint" as const;

  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    const root = process.env.RITSU_PROJECT_ROOT ?? process.cwd();
    const prefPath = resolve(root, ".ritsu/preferences.yaml");

    if (!existsSync(prefPath)) return violations;

    try {
      const raw = readFileSync(prefPath, "utf-8");
      const doc = yaml.load(raw) as any;
      const prefRules = doc?.rules || [];

      const content = ctx.content || "";

      for (const pref of prefRules) {
        // 1. match_regex
        if (pref.match_regex) {
          const regex = new RegExp(pref.match_regex, "g");
          if (regex.test(content)) {
            violations.push({
              rule_id: pref.id,
              severity: "warn", // preferences are typically warnings
              message: `Preference match: ${pref.id}`,
              evidence: pref.match_regex,
              suggestion: `Follow project preference defined in ${pref.id}`
            });
          }
        }

        // 2. forbid_lib
        if (pref.forbid_lib) {
          if (content.includes(`import`) && content.includes(pref.forbid_lib)) {
             violations.push({
              rule_id: pref.id,
              severity: "warn",
              message: `Forbidden library '${pref.forbid_lib}' detected.`,
              evidence: pref.forbid_lib,
              suggestion: `Use project preferred alternatives.`
            });
          }
        }

        // 3. require_call
        if (pref.require_call) {
          if (!content.includes(pref.require_call)) {
             violations.push({
              rule_id: pref.id,
              severity: "warn",
              message: `Required call '${pref.require_call}' missing.`,
              evidence: pref.require_call,
              suggestion: `Add the required call to follow project patterns.`
            });
          }
        }
      }
    } catch (e) {
      // ignore parse errors
    }

    return violations;
  }
}
