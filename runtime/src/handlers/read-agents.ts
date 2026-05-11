import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { errorResult, getProjectRoot, textResult, warnResult } from "./_utils.js";

type RulesOverrides = {
  disable?: string[];
  downgrade?: Array<{ id: string; severity: string }>;
  add?: Array<{ id: string; name?: string; scope?: string; rule?: string }>;
};

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
  const loaded = yaml.load(input);
  if (loaded && typeof loaded === "object") return loaded as Record<string, unknown>;
  return {};
}

export async function ritsu_read_agents(
  _params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const agentsPath = resolve(root, "AGENTS.md");

  if (!existsSync(agentsPath)) {
    return errorResult("AGENTS.md not found at project root");
  }

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

  const rulesOverrides =
    (overridesDoc["规则覆盖"] as { rules_overrides?: RulesOverrides } | undefined)
      ?.rules_overrides ??
    (baseDoc["rules_overrides"] as RulesOverrides | undefined) ??
    undefined;

  const techFingerprints =
    (fingerprintsDoc["技术栈特征"] as unknown[]) ??
    (baseDoc["tech_fingerprints"] as unknown[]) ??
    [];

  const data = {
    path: agentsPath,
    ritsu_version: ritsuVersion,
    domain,
    tech_fingerprints: techFingerprints,
    rules_overrides: rulesOverrides,
  };

  if (!ritsuBlock) {
    return warnResult(
      data,
      "Ritsu Configuration Block not found; parsed AGENTS.md with best-effort heuristics",
    );
  }

  return textResult(JSON.stringify(data));
}
