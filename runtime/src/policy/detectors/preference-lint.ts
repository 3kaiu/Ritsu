import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { DetectorPlugin, PolicyCheckContext, PolicyRule, PolicyViolation } from "../types.js";
import { getProjectRoot } from "../../handlers/_utils.js";

interface PreferenceRuleDoc {
  id: string;
  match_regex?: string;
  forbid_lib?: string;
  require_call?: string;
}

interface PreferencesDoc {
  rules?: PreferenceRuleDoc[];
  preferences?: PreferenceRuleDoc[];
}

function isPreferenceRule(value: unknown): value is PreferenceRuleDoc {
  if (typeof value !== "object" || value === null) return false;
  const rule = value as Record<string, unknown>;
  return (
    typeof rule.id === "string" &&
    (rule.match_regex === undefined || typeof rule.match_regex === "string") &&
    (rule.forbid_lib === undefined || typeof rule.forbid_lib === "string") &&
    (rule.require_call === undefined || typeof rule.require_call === "string")
  );
}

export class PreferenceLintDetector implements DetectorPlugin {
  type = "preference_lint" as const;

  detect(rule: PolicyRule, ctx: PolicyCheckContext): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    const root = getProjectRoot();
    const prefPath = resolve(root, ".ritsu/preferences.yaml");

    if (!existsSync(prefPath)) return violations;

    try {
      const raw = readFileSync(prefPath, "utf-8");
      const doc = yaml.load(raw) as PreferencesDoc | null;
      const prefRules = (
        Array.isArray(doc?.rules)
          ? doc.rules
          : Array.isArray(doc?.preferences)
            ? doc.preferences
            : []
      ).filter(isPreferenceRule);

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
              suggestion: `Follow project preference defined in ${pref.id}`,
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
              suggestion: `Use project preferred alternatives.`,
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
              suggestion: `Add the required call to follow project patterns.`,
            });
          }
        }
      }
    } catch {
      // ignore parse errors
    }

    return violations;
  }
}
