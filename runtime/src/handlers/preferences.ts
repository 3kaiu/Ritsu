import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";

const PREFERENCES_FILE = ".ritsu/preferences.yaml";

type PreferenceScope =
  | "coding_style"
  | "library_choice"
  | "naming_convention"
  | "architecture";

type PreferenceRule = {
  id: string;
  source?: string;
  match_regex?: string;
  forbid_lib?: string;
  require_call?: string;
  pattern?: string;
  scope: PreferenceScope;
  auto_inject_to: string[];
  confidence: number;
  created_at: string;
};

type PreferencesDoc = {
  rules: PreferenceRule[];
  preferences?: PreferenceRule[];
};

const VALID_SCOPES: PreferenceScope[] = [
  "coding_style",
  "library_choice",
  "naming_convention",
  "architecture",
];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizePreferenceRule(
  input: Partial<PreferenceRule> | undefined,
): PreferenceRule | null {
  if (!input?.scope || !VALID_SCOPES.includes(input.scope)) {
    return null;
  }

  const matchRegex =
    typeof input.match_regex === "string" && input.match_regex.trim()
      ? input.match_regex.trim()
      : typeof input.pattern === "string" && input.pattern.trim()
        ? input.pattern.trim()
        : undefined;
  const forbidLib =
    typeof input.forbid_lib === "string" && input.forbid_lib.trim()
      ? input.forbid_lib.trim()
      : undefined;
  const requireCall =
    typeof input.require_call === "string" && input.require_call.trim()
      ? input.require_call.trim()
      : undefined;

  if (!matchRegex && !forbidLib && !requireCall) {
    return null;
  }

  return {
    id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : "",
    source:
      typeof input.source === "string" && input.source.trim()
        ? input.source.trim()
        : undefined,
    match_regex: matchRegex,
    forbid_lib: forbidLib,
    require_call: requireCall,
    scope: input.scope,
    auto_inject_to: Array.isArray(input.auto_inject_to)
      ? input.auto_inject_to
          .filter((skill): skill is string => typeof skill === "string")
          .map((skill) => skill.trim())
          .filter(Boolean)
      : [],
    confidence:
      typeof input.confidence === "number" ? input.confidence : 0.8,
    created_at:
      typeof input.created_at === "string" && input.created_at.trim()
        ? input.created_at
        : new Date().toISOString(),
  };
}

function normalizePreferencesDoc(doc: PreferencesDoc | null | undefined): PreferencesDoc {
  const candidateRules = Array.isArray(doc?.rules)
    ? doc.rules
    : Array.isArray(doc?.preferences)
      ? doc.preferences
      : [];
  const rules = candidateRules
        .map((rule) => normalizePreferenceRule(rule))
        .filter((rule): rule is PreferenceRule => Boolean(rule))
  return { rules };
}

function getRuleIdentity(rule: PreferenceRule): string {
  if (rule.match_regex) return `regex:${rule.match_regex}`;
  if (rule.forbid_lib) return `forbid:${rule.forbid_lib}`;
  return `require:${rule.require_call}`;
}

export async function ritsu_read_preferences(): Promise<CallToolResult> {
  const root = getProjectRoot();
  const path = resolve(root, PREFERENCES_FILE);

  if (!existsSync(path)) {
    return textResult(JSON.stringify({ rules: [] }));
  }

  try {
    const content = readFileSync(path, "utf-8");
    const doc = normalizePreferencesDoc(yaml.load(content) as PreferencesDoc);
    return textResult(JSON.stringify(doc));
  } catch (error: unknown) {
    return errorResult(`Failed to read preferences: ${getErrorMessage(error)}`);
  }
}

export async function ritsu_write_preference(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const dir = resolve(root, ".ritsu");
  const path = resolve(root, PREFERENCES_FILE);

  const rawRule = params.rule as Partial<PreferenceRule> | undefined;
  const rule = normalizePreferenceRule(rawRule);
  if (!rule) {
    return errorResult(
      "Rule with 'scope' and one of 'match_regex', 'forbid_lib', or 'require_call' is required",
    );
  }

  if (!VALID_SCOPES.includes(rule.scope)) {
    return errorResult(`Invalid scope: ${rule.scope}. Must be one of: ${VALID_SCOPES.join(", ")}`);
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
      doc = normalizePreferencesDoc((yaml.load(content) as PreferencesDoc) || { rules: [] });
    } catch {
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

  // De-duplicate by semantic identity
  const existingIdx = doc.rules.findIndex(
    (r) => getRuleIdentity(r) === getRuleIdentity(rule),
  );
  if (existingIdx !== -1) {
    doc.rules[existingIdx] = { ...doc.rules[existingIdx], ...rule };
  } else {
    doc.rules.push(rule);
  }

  try {
    writeFileSync(path, yaml.dump(doc), "utf-8");
    return textResult(JSON.stringify({ ok: true, id: rule.id }));
  } catch (error: unknown) {
    return errorResult(`Failed to write preference: ${getErrorMessage(error)}`);
  }
}
