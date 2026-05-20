import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { detectProjectRoot } from "./project-root.js";

export interface RulesOverrides {
  disable?: string[];
  downgrade?: Array<{ id: string; severity: string }>;
  add?: Array<{ id: string; name?: string; scope?: string; rule?: string }>;
}

export interface AgentsProfile {
  path: string;
  ritsu_version: string;
  domain: string;
  tech_fingerprints: unknown[];
  rules_overrides?: RulesOverrides;
  lint_cmd?: string;
  test_cmd?: string;
  has_ritsu_block: boolean;
}

function extractBlock(
  content: string,
  startMarker: string,
  endMarker: string,
): string | null {
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) return null;
  const endIdx = content.indexOf(endMarker, startIdx + startMarker.length);
  if (endIdx === -1) return null;
  return content.slice(startIdx + startMarker.length, endIdx).trim();
}

function extractYamlLikeSection(content: string, sectionHeader: string): string | null {
  const lines = content.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.trim() === `${sectionHeader}:`);
  if (startIdx === -1) return null;

  const buf: string[] = [];
  buf.push(lines[startIdx].trim());

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      buf.push("");
      continue;
    }

    // stop when next top-level header begins (non-indented and ends with ':')
    if (/^[^\s].*:$/.test(line) && !/^\s/.test(line)) break;

    // keep indented lines and list items
    if (/^\s+/.test(line) || /^-\s/.test(line.trim())) {
      buf.push(line);
      continue;
    }

    break;
  }

  return buf.join("\n").trim();
}

function safeYamlLoad(input: string): Record<string, unknown> {
  try {
    const loaded = yaml.load(input);
    if (loaded && typeof loaded === "object") return loaded as Record<string, unknown>;
  } catch {
    // Ignore YAML syntax errors inside block
  }
  return {};
}

let cachedProfile: AgentsProfile | null = null;
let lastMtimeMs = 0;

export function getAgentsProfile(): AgentsProfile | null {
  const root = detectProjectRoot();
  const agentsPath = resolve(root, "AGENTS.md");

  if (!existsSync(agentsPath)) {
    return null;
  }

  let currentMtimeMs = 0;
  try {
    currentMtimeMs = statSync(agentsPath).mtimeMs;
  } catch {
    // If stats fail, bypass caching
  }

  if (cachedProfile && cachedProfile.path === agentsPath && currentMtimeMs === lastMtimeMs) {
    return cachedProfile;
  }

  try {
    const content = readFileSync(agentsPath, "utf-8");

    // 1) Core Ritsu block (preferred)
    const ritsuBlock = extractBlock(
      content,
      "<!-- Ritsu Configuration Block -->",
      "<!-- End Ritsu Block -->",
    );

    const baseDoc = ritsuBlock ? safeYamlLoad(ritsuBlock) : {};

    // 2) Optional project override section (YAML-like)
    const overridesSection = extractYamlLikeSection(content, "规则覆盖");
    const overridesDoc = overridesSection ? safeYamlLoad(overridesSection) : {};

    // 3) Optional fingerprints section (best-effort)
    const fingerprintsSection = extractYamlLikeSection(content, "技术栈特征");
    const fingerprintsDoc = fingerprintsSection ? safeYamlLoad(fingerprintsSection) : {};

    const domain =
      (baseDoc["domain"] as string | undefined) ??
      (content.match(/^domain\s*:\s*([^\n]+)$/im)?.[1]?.trim() || "");

    const ritsuVersion =
      (baseDoc["ritsu-version"] as string | undefined) ??
      (content.match(/^ritsu-version\s*:\s*([^\n]+)$/im)?.[1]?.trim() || "");

    let rulesOverrides =
      (overridesDoc["规则覆盖"] as { rules_overrides?: RulesOverrides } | undefined)
        ?.rules_overrides ??
      (baseDoc["rules_overrides"] as RulesOverrides | undefined) ??
      undefined;

    if (!rulesOverrides) {
      const fallbackMatch = content.match(/rules_overrides:\s*\n([\s\S]*?)<!-- End Ritsu Block -->/);
      if (fallbackMatch) {
        const parsed = safeYamlLoad(`rules_overrides:\n${fallbackMatch[1]}`);
        rulesOverrides = parsed["rules_overrides"] as RulesOverrides | undefined;
      }
    }

    const techFingerprints =
      (fingerprintsDoc["技术栈特征"] as unknown[]) ??
      (baseDoc["tech_fingerprints"] as unknown[]) ??
      [];

    // 4) Parse quality-gate commands: lint_cmd and test_cmd
    const lintCmd =
      (baseDoc["lint_cmd"] as string | undefined) ??
      (baseDoc["lint-cmd"] as string | undefined) ??
      (content.match(/lint[_-]?cmd\s*[:=]\s*`?([^`\n]+)`?/i)?.[1]?.trim() || undefined);

    const testCmd =
      (baseDoc["test_cmd"] as string | undefined) ??
      (baseDoc["test-cmd"] as string | undefined) ??
      (content.match(/test[_-]?cmd\s*[:=]\s*`?([^`\n]+)`?/i)?.[1]?.trim() || undefined);

    cachedProfile = {
      path: agentsPath,
      ritsu_version: ritsuVersion,
      domain,
      tech_fingerprints: techFingerprints,
      rules_overrides: rulesOverrides,
      lint_cmd: lintCmd,
      test_cmd: testCmd,
      has_ritsu_block: !!ritsuBlock,
    };
    lastMtimeMs = currentMtimeMs;
    return cachedProfile;
  } catch {
    return null;
  }
}
