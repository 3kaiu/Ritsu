import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";

const PREFERENCES_FILE = ".ritsu/preferences.yaml";

type PreferenceRule = {
  id: string;
  source: string;
  pattern: string;
  scope: "coding_style" | "library_choice" | "naming_convention" | "architecture";
  auto_inject_to: string[];
  confidence: number;
  created_at: string;
};

type PreferencesDoc = {
  rules: PreferenceRule[];
};

export async function ritsu_read_preferences(): Promise<CallToolResult> {
  const root = getProjectRoot();
  const path = resolve(root, PREFERENCES_FILE);

  if (!existsSync(path)) {
    return textResult(JSON.stringify({ rules: [] }));
  }

  try {
    const content = readFileSync(path, "utf-8");
    const doc = yaml.load(content) as PreferencesDoc;
    return textResult(JSON.stringify(doc || { rules: [] }));
  } catch (e: any) {
    return errorResult(`Failed to read preferences: ${e.message}`);
  }
}

export async function ritsu_write_preference(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const dir = resolve(root, ".ritsu");
  const path = resolve(root, PREFERENCES_FILE);

  const rule = params.rule as PreferenceRule;
  if (!rule || !rule.pattern || !rule.scope) {
    return errorResult("Rule with 'pattern' and 'scope' is required");
  }

  const validScopes = ["coding_style", "library_choice", "naming_convention", "architecture"];
  if (!validScopes.includes(rule.scope)) {
    return errorResult(`Invalid scope: ${rule.scope}. Must be one of: ${validScopes.join(", ")}`);
  }

  if (rule.confidence !== undefined && (rule.confidence < 0 || rule.confidence > 1)) {
    return errorResult("Confidence must be between 0 and 1");
  }

  if (rule.auto_inject_to && !Array.isArray(rule.auto_inject_to)) {
    return errorResult("auto_inject_to must be an array of skill names (e.g. ['think', 'dev'])");
  }

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let doc: PreferencesDoc = { rules: [] };
  if (existsSync(path)) {
    try {
      const content = readFileSync(path, "utf-8");
      doc = (yaml.load(content) as PreferencesDoc) || { rules: [] };
    } catch (e) {
      // ignore parse error, start fresh
    }
  }

  // Generate ID if missing
  if (!rule.id) {
    rule.id = `pref-${doc.rules.length + 1}`;
  }
  if (!rule.created_at) {
    rule.created_at = new Date().toISOString();
  }

  // De-duplicate by pattern
  const existingIdx = doc.rules.findIndex((r) => r.pattern === rule.pattern);
  if (existingIdx !== -1) {
    doc.rules[existingIdx] = { ...doc.rules[existingIdx], ...rule };
  } else {
    doc.rules.push(rule);
  }

  try {
    writeFileSync(path, yaml.dump(doc), "utf-8");
    return textResult(JSON.stringify({ ok: true, id: rule.id }));
  } catch (e: any) {
    return errorResult(`Failed to write preference: ${e.message}`);
  }
}
