import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { runGit } from "./_git-utils.js";
import {
  detectArtifactTypeFromFileName,
  getCanonicalArtifactType,
  getPreferredArtifactType,
} from "../shared.js";
import {
  getProjectRoot,
  errorResult,
  textResult,
  warnResult,
} from "./_utils.js";

const CONTRACT_ARTIFACT_PRIORITY = [
  { type: "handoff", prefix: "handoff-" },
  { type: "think-ticket", prefix: "think-ticket-" },
  { type: "intake-ticket", prefix: "intake-ticket-" },
] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractImplementationSection(content: string): string {
  const lines = content.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.trim() === "## 实施清单");
  if (startIdx === -1) return "";
  const buf: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s+/.test(line)) break;
    buf.push(line);
  }
  return buf.join("\n");
}

function extractExpectedIdentifiersFromContract(content: string): string[] {
  const implementationSection = extractImplementationSection(content);
  const sourceText = implementationSection.trim() ? implementationSection : content;

  const rawTokens = new Set<string>();

  for (const m of sourceText.matchAll(/`([^`]+)`/g)) {
    const t = m[1].trim();
    if (!t) continue;
    rawTokens.add(t);
  }

  for (const m of sourceText.matchAll(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g)) {
    rawTokens.add(m[0]);
  }

  const stop = new Set([
    "http",
    "https",
    "file",
    "path",
    "lint",
    "test",
    "true",
    "false",
    "null",
    "undefined",
    "string",
    "number",
    "boolean",
  ]);

  const filtered = Array.from(rawTokens)
    .map((t) => t.replace(/\(\)$/g, "").trim())
    .filter((t) => t.length >= 3)
    .filter((t) => !stop.has(t.toLowerCase()))
    .filter((t) => !t.includes("/"))
    .filter((t) => !t.includes("."))
    .filter((t) => !/^\d/.test(t))
    .filter((t) => /^[A-Za-z_]/.test(t));

  return Array.from(new Set(filtered)).sort((a, b) => a.localeCompare(b));
}

function detectContractArtifactType(path: string): string {
  const fileName = path.split("/").pop() ?? path;
  return detectArtifactTypeFromFileName(fileName) ?? "unknown";
}

function findLatestContractArtifact(root: string): {
  path: string;
  artifact_type: string;
} | null {
  const dir = resolve(root, ".ritsu");
  if (!existsSync(dir)) return null;

  const entries = readdirSync(dir)
    .filter((f: string) => f.endsWith(".md"))
    .map((f: string) => ({
      path: resolve(dir, f),
      name: f,
      mtime: statSync(resolve(dir, f)).mtimeMs,
    }));

  for (const { type, prefix } of CONTRACT_ARTIFACT_PRIORITY) {
    const files = entries
      .filter((entry) => entry.name.startsWith(prefix))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length > 0) {
      return { path: files[0].path, artifact_type: type };
    }
  }

  return null;
}

function findIdentifierCoverage(
  expected: string[],
  diffText: string,
): {
  covered: string[];
  missing: string[];
  coverage_ratio: number;
} {
  if (expected.length === 0) {
    return { covered: [], missing: [], coverage_ratio: 1 };
  }

  const covered: string[] = [];
  const missing: string[] = [];

  for (const id of expected) {
    const re = new RegExp(`\\b${escapeRegExp(id)}\\b`);
    if (re.test(diffText)) covered.push(id);
    else missing.push(id);
  }

  const ratio = covered.length / expected.length;
  return { covered, missing, coverage_ratio: ratio };
}

export async function ritsu_contract_validate(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const minCoverage = Math.max(
    0,
    Math.min(1, Number(params.min_coverage ?? 0.8)),
  );
  const cached = params.cached === true;
  const artifactPathParam = String(
    params.artifact_path ?? params.handoff_path ?? "",
  ).trim();

  let artifactPath = artifactPathParam;
  let artifactType = artifactPath ? detectContractArtifactType(artifactPath) : "";

  if (!artifactPath) {
    const latestArtifact = findLatestContractArtifact(root);
    if (!latestArtifact) {
      return warnResult(
        {
          passed: true,
          reason: "no contract artifact found; skip contract validation",
        },
        "no contract artifact found; skip contract validation",
      );
    }
    artifactPath = latestArtifact.path;
    artifactType = latestArtifact.artifact_type;
  }

  if (!existsSync(artifactPath)) {
    return errorResult(`contract artifact not found: ${artifactPath}`);
  }

  const contractContent = readFileSync(artifactPath, "utf-8");
  const expectedIdentifiers =
    extractExpectedIdentifiersFromContract(contractContent);

  const diffArgs = cached
    ? ["diff", "--unified=3", "--cached"]
    : ["diff", "--unified=3"];
  const diffR = await runGit(diffArgs, root);
  if (!diffR.ok) return errorResult(`git diff failed: ${diffR.output}`);

  const coverage = findIdentifierCoverage(expectedIdentifiers, diffR.output);
  const passed = coverage.coverage_ratio >= minCoverage;

  return textResult(
    JSON.stringify({
      passed,
      min_coverage: minCoverage,
      coverage_ratio: coverage.coverage_ratio,
      expected_total: expectedIdentifiers.length,
      covered: coverage.covered,
      missing: coverage.missing,
      artifact_path: artifactPath,
      artifact_type: getPreferredArtifactType(artifactType),
      canonical_type: getCanonicalArtifactType(artifactType),
      detected_type: artifactType,
      handoff_path: artifactPath,
      cached,
    }),
  );
}
