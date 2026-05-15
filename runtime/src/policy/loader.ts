import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { PolicyRule, Severity } from "./types.js";
import { getProjectRoot } from "../handlers/_utils.js"; // wait, cannot import from handlers like this directly, need to check if _utils.ts exists there
// Actually, I can use process.env.RITSU_PROJECT_ROOT ?? process.cwd()

function getProjectRootLocal(): string {
  return process.env.RITSU_PROJECT_ROOT ?? process.cwd();
}

interface RulesOverrides {
  disable?: string[];
  downgrade?: Array<{ id: string; severity: Severity }>;
}

export function loadPolicies(): PolicyRule[] {
  const root = getProjectRootLocal();
  
  // 1. Load baseline anti-patterns
  const apPath = resolve(__dirname, "../../../../rules/anti-patterns.yaml");
  let rules: PolicyRule[] = [];
  if (existsSync(apPath)) {
    const raw = readFileSync(apPath, "utf-8");
    const doc = yaml.load(raw) as any;
    if (doc) {
      if (Array.isArray(doc.global)) rules.push(...doc.global);
      if (Array.isArray(doc.review)) rules.push(...doc.review);
    }
  }

  // 2. Load overrides from AGENTS.md
  const agentsPath = resolve(root, "AGENTS.md");
  if (existsSync(agentsPath)) {
    const agentsContent = readFileSync(agentsPath, "utf-8");
    const overrideMatch = agentsContent.match(/rules_overrides:\s*\n([\s\S]*?)<!-- End Ritsu Block -->/);
    if (overrideMatch) {
      try {
        const overridesDoc = yaml.load(`rules_overrides:\n${overrideMatch[1]}`) as { rules_overrides: RulesOverrides };
        const overrides = overridesDoc?.rules_overrides;
        
        if (overrides) {
          if (Array.isArray(overrides.disable)) {
            rules = rules.filter(r => !overrides.disable!.includes(r.id));
          }
          if (Array.isArray(overrides.downgrade)) {
            for (const dg of overrides.downgrade) {
              const rule = rules.find(r => r.id === dg.id);
              if (rule) {
                rule.severity = dg.severity;
              }
            }
          }
        }
      } catch {
        // ignore yaml parse errors in AGENTS.md block
      }
    }
  }

  return rules;
}
