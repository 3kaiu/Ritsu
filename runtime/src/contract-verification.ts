/**
 * Contract Verification Engine
 *
 * Three-level verification pipeline that answers:
 *   "Does the test suite actually verify what the contract promises?"
 *
 * Level 1 — Structural:  Does a test file exist at the hinted path?
 * Level 2 — Content:     Does the test file reference the contract by ID, description,
 *                         or keyword (via annotations, describe blocks, test names)?
 * Level 3 — Semantic:    Does the test actually exercise the contract's target
 *                         function/component? (call-trace matching)
 *
 * Level 3 is aspirational (requires dynamic analysis) — implemented as a stub
 * that returns "not_checked" for now.
 *
 * v8.3.0
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { globSync } from "fast-glob";
import {
  updateContractStatus,
  getActiveContracts,
  type ContractEntry,
  type ContractStatus,
} from "./contract-registry.js";
import { analyzeContractCoverage } from "./test-oracle.js";

// ─── Types ────────────────────────────────────────────────────

export type VerificationLevel = 1 | 2 | 3;

export interface ContractVerificationResult {
  contract_id: string;
  description: string;
  level_1: Verdict; // structural: test file exists
  level_2: Verdict; // content: test references contract
  level_3: Verdict; // semantic: test exercises contract target
  overall: ContractStatus;
  evidence: string;
}

export interface Verdict {
  status: "pass" | "fail" | "not_checked";
  detail: string;
  file?: string;
  line?: number;
}

export interface VerificationReport {
  generated_at: string;
  total: number;
  verified: number;
  partial: number;
  failed: number;
  not_found: number;
  results: ContractVerificationResult[];
  summary: string;
}

// ─── Keyword Extraction ──────────────────────────────────────

/**
 * Extract meaningful keywords from a contract description.
 * Filters out stopwords and returns significant terms for matching.
 */
function extractKeywords(description: string): string[] {
  const stopwords = new Set([
    "the", "a", "an", "with", "for", "and", "or", "of", "to",
    "in", "on", "at", "by", "is", "are", "was", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did",
    "will", "would", "could", "should", "may", "might", "shall",
    "this", "that", "these", "those", "it", "its", "you", "your",
  ]);

  // Split on non-alphanumeric (excluding CJK)
  const words = description
    .toLowerCase()
    .split(/[\s,;:.!?()\[\]{}"'/\\@#$%^&*+=<>]+/)
    .filter((w) => w.length > 2 && !stopwords.has(w));

  return [...new Set(words)];
}

/**
 * Extract key phrases from description:
 *   "POST /auth/login endpoint with JWT" → ["POST /auth/login", "JWT"]
 *   "User dashboard with real-time order list" → ["dashboard", "order list"]
 */
export function extractKeyPhrases(description: string): string[] {
  const phrases: string[] = [];

  // Match HTTP methods + paths
  const httpMatch = description.match(/\b(GET|POST|PUT|DELETE|PATCH)\s+\/\S+/i);
  if (httpMatch) phrases.push(httpMatch[0].toLowerCase());

  // Match quoted terms
  const quoted = description.match(/["'`]([^"'`]+)["'`]/g);
  if (quoted) {
    phrases.push(...quoted.map((q) => q.replace(/["'`]/g, "").toLowerCase()));
  }

  // Match camelCase and PascalCase terms
  const camelCase = description.match(/\b[A-Z][a-z]+[A-Z][a-zA-Z]*\b/g);
  if (camelCase) phrases.push(...camelCase.map((c) => c.toLowerCase()));

  // Match API paths
  const apiPath = description.match(/\/[a-z/_-]+/g);
  if (apiPath) phrases.push(...apiPath.map((p) => p.toLowerCase()));

  return [...new Set(phrases)];
}

// ─── Level 1: Structural ─────────────────────────────────────

/**
 * Check if a test file exists for the contract.
 * Uses test_file_hint to locate the file, with glob fallback.
 */
function checkLevel1(
  contract: ContractEntry,
  projectRoot: string,
): Verdict {
  const hint = contract.test_file_hint;
  if (!hint) {
    return { status: "fail", detail: "No test file hint provided in contract" };
  }

  // Direct path check
  const directPath = resolve(projectRoot, hint);
  if (existsSync(directPath)) {
    return { status: "pass", detail: `Test file found at hinted path`, file: hint };
  }

  // Try with test/ prefix variations
  const variations = [
    hint,
    `tests/${hint.replace(/^\/?/, "")}`,
    `src/tests/${hint.replace(/^\/?/, "")}`,
    `test/${hint.replace(/^\/?/, "")}`,
    `__tests__/${hint.replace(/^\/?/, "")}`,
  ];

  for (const v of variations) {
    const absPath = resolve(projectRoot, v);
    if (existsSync(absPath)) {
      return { status: "pass", detail: `Test file found at ${v}`, file: v };
    }
  }

  // Glob fallback: search for files matching the hint basename
  const basename = hint.split(/[/\\]/).pop() || hint;
  const globResults = globSync(`**/*${basename}*`, {
    cwd: projectRoot,
    absolute: false,
    ignore: ["**/node_modules/**", "**/dist/**"],
  });

  if (globResults.length > 0) {
    return {
      status: "pass",
      detail: `Test file found via glob: ${globResults[0]}`,
      file: globResults[0],
    };
  }

  return { status: "fail", detail: `No test file found for hint: ${hint}` };
}

// ─── Level 2: Content ────────────────────────────────────────

/**
 * Check if a test file's content actually references the contract.
 *
 * Scans for:
 *   1. Annotation comments like `// covers: C1` or `// contract: C1`
 *   2. `describe("C1", ...)` or `describe("contract C1", ...)` blocks
 *   3. Test names containing contract ID or keywords
 *   4. Assertions that match contract keywords/phrases
 */
function checkLevel2(
  contract: ContractEntry,
  testFilePath: string | undefined,
  projectRoot: string,
): Verdict {
  if (!testFilePath) {
    return { status: "not_checked", detail: "No test file to inspect" };
  }

  const absPath = resolve(projectRoot, testFilePath);
  if (!existsSync(absPath)) {
    return { status: "not_checked", detail: `Test file not found: ${testFilePath}` };
  }

  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return { status: "not_checked", detail: `Cannot read test file: ${testFilePath}` };
  }

  const lines = content.split("\n");

  // 1. Check for annotation comments
  const annotationRegex = new RegExp(
    `//\\s*(?:covers?|contract|verifies?)\\s*:?\\s*${escapeRegex(contract.id)}`,
    "i",
  );
  for (let i = 0; i < lines.length; i++) {
    if (annotationRegex.test(lines[i])) {
      return {
        status: "pass",
        detail: `Contract ${contract.id} annotated in test file`,
        file: testFilePath,
        line: i + 1,
      };
    }
  }

  // 2. Check describe/test blocks with contract ID
  const idBlockRegex = new RegExp(
    `\\b(describe|it|test)\\s*\\(\\s*["'\`][^"'\`]*${escapeRegex(contract.id)}[^"'\`]*["'\`]`,
    "i",
  );
  for (let i = 0; i < lines.length; i++) {
    if (idBlockRegex.test(lines[i])) {
      return {
        status: "pass",
        detail: `Contract ${contract.id} referenced in test block`,
        file: testFilePath,
        line: i + 1,
      };
    }
  }

  // 3. Check for description keywords in test names
  const keywords = extractKeywords(contract.description);
  const phrases = extractKeyPhrases(contract.description);
  const allTerms = [...keywords, ...phrases];

  if (allTerms.length > 0) {
    // Check if any test/describe line contains a significant term
    const testLines = lines.filter((l) =>
      /\b(it|test|describe)\s*\(/.test(l),
    );

    for (let i = 0; i < lines.length; i++) {
      const lowerLine = lines[i].toLowerCase();
      if (!/\b(it|test|describe)\s*\(/.test(lines[i])) continue;

      const matchingTerms = allTerms.filter((t) => lowerLine.includes(t));
      if (matchingTerms.length >= 1) {
        return {
          status: "pass",
          detail: `Test matches contract keywords: ${matchingTerms.slice(0, 3).join(", ")}`,
          file: testFilePath,
          line: i + 1,
        };
      }
    }
  }

  // 4. Check for assertions that exercise contract-related function names
  if (phrases.length > 0) {
    for (let i = 0; i < lines.length; i++) {
      const lowerLine = lines[i].toLowerCase();
      if (!/\bexpect\s*\(/.test(lowerLine)) continue;

      const matchingPhrases = phrases.filter((p) => lowerLine.includes(p));
      if (matchingPhrases.length > 0) {
        return {
          status: "pass",
          detail: `Assertion references contract term: ${matchingPhrases[0]}`,
          file: testFilePath,
          line: i + 1,
        };
      }
    }
  }

  return {
    status: "fail",
    detail: `No reference to contract ${contract.id} or its keywords found in test file`,
    file: testFilePath,
  };
}

// ─── Level 3: Semantic (stub) ─────────────────────────────────

/**
 * Check if the test actually calls the contract's target function.
 *
 * Level 3 requires dynamic analysis (trace-level matching).
 * Implemented as a stub that returns "not_checked" — the infrastructure
 * for call-trace capture is not yet available in Ritsu's test runner.
 *
 * Future: when ritsu_run_quality_gates captures per-test coverage data,
 * this level can verify that the contract's target function appears
 * in the coverage report.
 */
function checkLevel3(
  contract: ContractEntry,
  testFilePath: string | undefined,
  projectRoot: string,
): Verdict {
  if (!testFilePath) {
    return { status: "not_checked", detail: "Semantic verification requires test file" };
  }

  // Find Istanbul coverage data (try common locations)
  const coverageCandidates = [
    resolve(projectRoot, "coverage", "coverage-final.json"),
    resolve(projectRoot, ".ritsu", "coverage-final.json"),
    resolve(projectRoot, "runtime", "coverage", "coverage-final.json"),
  ];

  let coveragePath = "";
  for (const candidate of coverageCandidates) {
    if (existsSync(candidate)) { coveragePath = candidate; break; }
  }

  if (!coveragePath) {
    return {
      status: "not_checked",
      detail: "No Istanbul coverage data found. Run `bun run --coverage` first.",
      file: testFilePath,
    };
  }

  const result = analyzeContractCoverage(contract.id, contract.description, coveragePath);

  if (result.function_coverage.length === 0) {
    return {
      status: "not_checked",
      detail: `No functions matched contract "${contract.id}" in coverage data. Add keyword-friendly descriptions.`,
      file: testFilePath,
    };
  }

  const uncoveredNames = result.uncovered_functions;
  const uncoveredBranchCount = result.uncovered_branches.length;

  if (uncoveredNames.length === 0 && uncoveredBranchCount === 0) {
    return {
      status: "pass",
      detail: `All ${result.function_coverage.length} matched functions exercised, ${result.branch_coverage.length} branches covered`,
      file: testFilePath,
    };
  }

  const parts: string[] = [];
  if (uncoveredNames.length > 0) parts.push(`${uncoveredNames.length} functions not hit: ${uncoveredNames.join(", ")}`);
  if (uncoveredBranchCount > 0) parts.push(`${uncoveredBranchCount} branches not covered`);
  return {
    status: "fail",
    detail: parts.join("; "),
    file: testFilePath,
  };
}

// ─── Utility ─────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Main Verification ───────────────────────────────────────

/**
 * Run the three-level verification pipeline for all active contracts.
 *
 * This is the main entry point called from quality gates.
 */
export function verifyContracts(
  projectRoot: string,
): VerificationReport {
  const activeContracts = getActiveContracts(projectRoot);

  if (activeContracts.length === 0) {
    return {
      generated_at: new Date().toISOString(),
      total: 0,
      verified: 0,
      partial: 0,
      failed: 0,
      not_found: 0,
      results: [],
      summary: "No contracts found in registry.",
    };
  }

  const results: ContractVerificationResult[] = [];
  let verifiedCount = 0;
  let partialCount = 0;
  let failedCount = 0;
  let notFoundCount = 0;

  for (const contract of activeContracts) {
    // Level 1: test file exists
    const l1 = checkLevel1(contract, projectRoot);
    const testFile = l1.file;

    // Level 2: test references contract
    const l2 = l1.status === "pass"
      ? checkLevel2(contract, testFile, projectRoot)
      : { status: "not_checked" as const, detail: "Skipped — no test file found" };

    // Level 3: test exercises target (stub)
    const l3 = checkLevel3(contract, testFile, projectRoot);

    // Determine overall status
    let overall: ContractStatus;
    let evidence: string;

    if (l1.status === "pass" && l2.status === "pass") {
      overall = "verified";
      evidence = l2.file && l2.line ? `${l2.file}:${l2.line}` : (l2.detail || l1.detail);
      verifiedCount++;
    } else if (l1.status === "pass" && l2.status === "fail") {
      overall = "partial";
      evidence = `File exists at ${testFile} but no contract reference found. ${l2.detail}`;
      partialCount++;
    } else if (l1.status === "pass" && l2.status === "not_checked") {
      overall = "partial";
      evidence = l1.detail;
      partialCount++;
    } else {
      overall = "failed";
      evidence = l1.detail;
      failedCount++;
    }

    // Update registry
    updateContractStatus(projectRoot, contract.id, overall, evidence);

    results.push({
      contract_id: contract.id,
      description: contract.description,
      level_1: l1,
      level_2: l2,
      level_3: l3,
      overall,
      evidence,
    });
  }

  notFoundCount = failedCount;

  // Build summary
  const summaryLines = [
    `# Contract Verification Report`,
    ``,
    `Total: ${results.length} | ✅ Verified: ${verifiedCount} | 🔶 Partial: ${partialCount} | ❌ Failed: ${failedCount}`,
    ``,
    results.length > 0 ? "## Per-Contract Results" : "",
    ...results.map((r) => {
      const icon = r.overall === "verified" ? "✅" : r.overall === "partial" ? "🔶" : "❌";
      return `- ${icon} ${r.contract_id}: ${r.description.slice(0, 60)} — ${r.evidence}`;
    }),
  ].filter(Boolean).join("\n");

  return {
    generated_at: new Date().toISOString(),
    total: results.length,
    verified: verifiedCount,
    partial: partialCount,
    failed: failedCount,
    not_found: notFoundCount,
    results,
    summary: summaryLines,
  };
}

/**
 * Verify specific contracts (filtered by ID list).
 * Used by ritsu_dispatch_task to verify only assigned contracts.
 */
export function verifyContractsById(
  projectRoot: string,
  contractIds: string[],
): VerificationReport {
  // Get only the specified contracts from all active ones
  const targetIds = new Set(contractIds);
  const allActive = getActiveContracts(projectRoot);
  const filtered = allActive.filter((c) => targetIds.has(c.id));

  if (filtered.length === 0) {
    return {
      generated_at: new Date().toISOString(),
      total: 0,
      verified: 0,
      partial: 0,
      failed: 0,
      not_found: 0,
      results: [],
      summary: "No matching contracts found.",
    };
  }

  // Run verification on the filtered contracts
  const report = verifyContracts(projectRoot);
  // Filter results to only the requested contracts
  report.results = report.results.filter((r) => targetIds.has(r.contract_id));
  report.total = report.results.length;
  report.verified = report.results.filter((r) => r.overall === "verified").length;
  report.partial = report.results.filter((r) => r.overall === "partial").length;
  report.failed = report.results.filter((r) => r.overall === "failed").length;
  return report;
}
