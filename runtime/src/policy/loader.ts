import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { DetectorConfig, ExemptionConfig, PolicyRule, Severity } from "./types.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { getAgentsProfile } from "../agents-parser.js";
import { reconcilePreferences } from "./detectors/ast-grep-reconciler.js";

function getProjectRootLocal(): string {
  return process.env.RITSU_PROJECT_ROOT ?? process.cwd();
}


interface AntiPatternsDoc {
  global?: PolicyRule[];
  review?: PolicyRule[];
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeSeverity(value: unknown): Severity | null {
  if (typeof value !== "string") return null;

  switch (value.toLowerCase()) {
    case "fatal":
      return "fatal";
    case "error":
      return "error";
    case "warn":
      return "warn";
    case "hard_stop":
      return "hard_stop";
    default:
      return null;
  }
}

function isDowngradeOverride(
  value: unknown,
): value is { id: string; severity: Severity } {
  if (!isRecord(value)) return false;
  const override = value;
  return (
    typeof override.id === "string" &&
    normalizeSeverity(override.severity) !== null
  );
}

function normalizeExemptions(value: unknown): ExemptionConfig[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const exemptions: ExemptionConfig[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isRecord(entry.when)) continue;

    const skill =
      typeof entry.when.skill === "string" ? entry.when.skill : undefined;
    const targetFile =
      typeof entry.when.target_file === "string"
        ? entry.when.target_file
        : undefined;
    if (!skill && !targetFile) continue;

    exemptions.push({
      when: {
        skill,
        target_file: targetFile,
      },
    });
  }

  return exemptions.length > 0 ? exemptions : undefined;
}

function normalizeDetector(value: unknown): DetectorConfig | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    return undefined;
  }

  return {
    ...value,
    type: value.type as DetectorConfig["type"],
    target:
      value.target === "artifact_content" || value.target === "diff"
        ? value.target
        : undefined,
  };
}

function normalizePolicyRule(value: unknown): PolicyRule | null {
  if (!isRecord(value)) return null;

  const severity = normalizeSeverity(value.severity);
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !severity
  ) {
    return null;
  }

  const detector = normalizeDetector(value.detector);
  const detectorRecord = isRecord(value.detector) ? value.detector : undefined;
  const directExemption = normalizeExemptions(value.exemption);
  const detectorExemption = normalizeExemptions(detectorRecord?.exemption);

  return {
    id: value.id,
    name: value.name,
    severity,
    detector,
    exemption: directExemption ?? detectorExemption,
  };
}

function normalizeRules(value: unknown): PolicyRule[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => normalizePolicyRule(entry))
    .filter((entry): entry is PolicyRule => entry !== null);
}

let cachedRules: PolicyRule[] | null = null;
let lastApMtime = 0;
let lastAgentsMtime = 0;
let lastPrefMtime = 0;

export function loadPolicies(): PolicyRule[] {
  const root = getProjectRootLocal();
  const apPath = resolve(__dirname, "../../../rules/anti-patterns.yaml");
  const agentsPath = resolve(root, "AGENTS.md");
  const prefPath = resolve(root, ".ritsu/preferences.yaml");

  let apMtime = 0;
  let agentsMtime = 0;
  let prefMtime = 0;
  try {
    if (existsSync(apPath)) apMtime = statSync(apPath).mtimeMs;
    if (existsSync(agentsPath)) agentsMtime = statSync(agentsPath).mtimeMs;
    if (existsSync(prefPath)) prefMtime = statSync(prefPath).mtimeMs;
  } catch {
    // ignore filesystem read or permission errors during static analysis
  }

  // If preferences.yaml changed, reconcile AST-Grep rules automatically!
  if (prefMtime !== lastPrefMtime) {
    try {
      reconcilePreferences();
    } catch {
      // fail-safe
    }
    lastPrefMtime = prefMtime;
    cachedRules = null; // Clear cached rules to force reload
  }

  if (cachedRules && apMtime === lastApMtime && agentsMtime === lastAgentsMtime) {
    return JSON.parse(JSON.stringify(cachedRules));
  }

  // 1. Load baseline anti-patterns
  let rules: PolicyRule[] = [];
  if (existsSync(apPath)) {
    const raw = readFileSync(apPath, "utf-8");
    const doc = yaml.load(raw) as AntiPatternsDoc | null;
    if (doc) {
      rules.push(...normalizeRules(doc.global));
      rules.push(...normalizeRules(doc.review));
    }
  }

  // 2. Load overrides from AGENTS.md
  const profile = getAgentsProfile();
  const overrides = profile?.rules_overrides;
  if (overrides) {
    const disabledIds = Array.isArray(overrides.disable)
      ? overrides.disable.filter((id): id is string => typeof id === "string")
      : [];
    if (disabledIds.length > 0) {
      rules = rules.filter((rule) => !disabledIds.includes(rule.id));
    }
    const downgrades = Array.isArray(overrides.downgrade)
      ? overrides.downgrade
          .filter(isDowngradeOverride)
          .map((override) => ({
            id: override.id,
            severity: normalizeSeverity(override.severity) ?? "warn",
          }))
      : [];
    if (downgrades.length > 0) {
      for (const dg of downgrades) {
        const rule = rules.find((candidate) => candidate.id === dg.id);
        if (rule) {
          rule.severity = dg.severity;
        }
      }
    }
  }

  cachedRules = rules;
  lastApMtime = apMtime;
  lastAgentsMtime = agentsMtime;

  return JSON.parse(JSON.stringify(rules));
}
