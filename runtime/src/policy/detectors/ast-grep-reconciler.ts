import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import yaml from "js-yaml";
import { getProjectRoot } from "../../handlers/_utils.js";

interface PreferenceRuleDoc {
  id: string;
  match_regex?: string;
  forbid_lib?: string;
  require_call?: string;
  language?: string;
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
    (rule.require_call === undefined || typeof rule.require_call === "string") &&
    (rule.language === undefined || typeof rule.language === "string")
  );
}

function getCalleeText(expressionStr: string): string {
  const trimmed = expressionStr.trim();
  const callIndex = trimmed.indexOf("(");
  const callee = callIndex !== -1 ? trimmed.substring(0, callIndex) : trimmed;
  return callee.replace(/\s+/g, "");
}

export function reconcilePreferences(): boolean {
  try {
    const root = getProjectRoot();
    const prefPath = resolve(root, ".ritsu/preferences.yaml");
    const rulesDir = resolve(root, "rules/ast-grep");

    if (!existsSync(prefPath)) {
      cleanupStaleRules(rulesDir, new Set());
      return true;
    }

    const raw = readFileSync(prefPath, "utf-8");
    const doc = yaml.load(raw) as PreferencesDoc | null;
    const prefRules = (
      Array.isArray(doc?.rules)
        ? doc.rules
        : Array.isArray(doc?.preferences)
          ? doc.preferences
          : []
    ).filter(isPreferenceRule);

    if (!existsSync(rulesDir)) {
      mkdirSync(rulesDir, { recursive: true });
    }

    const activePrefIds = new Set<string>();

    for (const pref of prefRules) {
      activePrefIds.add(pref.id);

      const ruleId = `pref-${pref.id}`;
      const ruleFilePath = join(rulesDir, `${ruleId}.yml`);

      let ruleContent: Record<string, unknown> | null = null;
      const language = typeof pref.language === "string" ? pref.language : "TypeScript";

      if (pref.forbid_lib) {
        ruleContent = {
          id: ruleId,
          message: `Forbidden library '${pref.forbid_lib}' detected via AST-Grep.`,
          severity: "warning",
          language,
          rule: {
            any: [
              { pattern: `import $_ from '${pref.forbid_lib}'` },
              { pattern: `import { $$$ } from '${pref.forbid_lib}'` },
              { pattern: `import * as $_ from '${pref.forbid_lib}'` },
              { pattern: `require('${pref.forbid_lib}')` }
            ]
          }
        };
      } else if (pref.match_regex) {
        ruleContent = {
          id: ruleId,
          message: `Preference rule match: ${pref.id}`,
          severity: "warning",
          language,
          rule: {
            pattern: "$A"
          },
          constraints: {
            A: {
              regex: pref.match_regex
            }
          }
        };
      } else if (pref.require_call) {
        const callee = getCalleeText(pref.require_call);
        ruleContent = {
          id: ruleId,
          message: `Required call '${pref.require_call}' missing.`,
          severity: "warning",
          language,
          rule: {
            not: {
              has: {
                pattern: `${callee}($$$)`
              }
            }
          }
        };
      }

      if (ruleContent) {
        writeFileSync(ruleFilePath, yaml.dump(ruleContent), "utf-8");
      }
    }

    cleanupStaleRules(rulesDir, activePrefIds);

    return true;
  } catch (e) {
    return false;
  }
}

function cleanupStaleRules(rulesDir: string, activePrefIds: Set<string>) {
  if (!existsSync(rulesDir)) return;

  try {
    const files = readdirSync(rulesDir);
    for (const file of files) {
      if (file.startsWith("pref-") && file.endsWith(".yml")) {
        const prefId = file.substring("pref-".length, file.length - ".yml".length);
        if (!activePrefIds.has(prefId)) {
          try {
            unlinkSync(join(rulesDir, file));
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // ignore
  }
}
