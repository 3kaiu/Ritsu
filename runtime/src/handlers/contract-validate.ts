import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { runGit } from "./_git-utils.js";
import {
  getProjectRoot,
  errorResult,
  textResult,
  warnResult,
} from "./_utils.js";

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

function extractExpectedIdentifiersFromHandoff(content: string): string[] {
  const section = extractImplementationSection(content);
  if (!section.trim()) return [];

  const rawTokens = new Set<string>();

  for (const m of section.matchAll(/`([^`]+)`/g)) {
    const t = m[1].trim();
    if (!t) continue;
    rawTokens.add(t);
  }

  for (const m of section.matchAll(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g)) {
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
  const handoffPathParam = String(params.handoff_path ?? "").trim();

  let handoffPath = handoffPathParam;

  if (!handoffPath) {
    const dir = resolve(root, ".ritsu");
    if (!existsSync(dir)) {
      return warnResult(
        {
          passed: true,
          reason: "no .ritsu directory; skip contract validation",
        },
        "no .ritsu directory; skip contract validation",
      );
    }

    const files = readdirSync(dir)
      .filter((f: string) => f.startsWith("handoff-") && f.endsWith(".md"))
      .map((f: string) => ({
        path: resolve(dir, f),
        mtime: statSync(resolve(dir, f)).mtimeMs,
      }))
      .sort((a: any, b: any) => b.mtime - a.mtime);

    if (files.length === 0) {
      return warnResult(
        { passed: true, reason: "no handoff found; skip contract validation" },
        "no handoff found; skip contract validation",
      );
    }

    handoffPath = files[0].path;
  }

  if (!existsSync(handoffPath)) {
    return errorResult(`handoff file not found: ${handoffPath}`);
  }

  const handoffContent = readFileSync(handoffPath, "utf-8");
  const expectedIdentifiers =
    extractExpectedIdentifiersFromHandoff(handoffContent);

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
      handoff_path: handoffPath,
      cached,
    }),
  );
}
