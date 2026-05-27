/**
 * Test Quality Intelligence Engine
 *
 * Analyzes test files for quality metrics beyond coverage %:
 * - Assertion density: asserts per test case
 * - No-assertion tests: tests that pass without verifying anything
 * - Snapshot-only tests: tests relying solely on toMatchSnapshot
 * - Mock gap: external dependencies not mocked
 * - Contract coverage: design-sheet contracts mapped to test assertions
 *
 * v8.1.0 — no new dependencies, no MCP tool, pure analysis functions.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { globSync } from "fast-glob";

// ─── Types ────────────────────────────────────────────────────

export interface TestQualityMetrics {
  total_tests: number;
  tests_without_assertions: number;
  snapshot_only: number;
  assertion_density: number; // total assertions / total tests
  mock_gap: string[]; // external deps not mocked
  contract_coverage: number; // % of contracts with matching test assertions
  quality_score: number; // 0-100 composite score
}

export interface TestFileAnalysis {
  file: string;
  test_count: number;
  assertion_count: number;
  no_assertion_tests: string[];
  snapshot_only_tests: string[];
  unmocked_deps: string[];
}

export interface ContractMapping {
  contract_id: string;
  description: string;
  covered: boolean;
  matching_assertions: string[];
}

// ─── Configuration ────────────────────────────────────────────

const TEST_GLOB_PATTERNS = [
  "**/*.test.{ts,tsx,js,jsx}",
  "**/*.spec.{ts,tsx,js,jsx}",
  "**/tests/**/*.{ts,tsx,js,jsx}",
  "**/__tests__/**/*.{ts,tsx,js,jsx}",
];

/**
 * Primary assertion entry point patterns.
 * Counted as one assertion per match (avoids double-counting expect + matcher).
 */
const ASSERTION_ENTRY_PATTERNS = [
  /\bexpect\s*\(/g,
  /\bassert\.(?:ok|equal|strictEqual|deepEqual|true|false|throws|doesNotThrow|rejects|resolve|is|ifError|notEqual|notDeepEqual|fail)\s*\(/g,
  /\bt\.(?:is|deepEqual|ok|true|false|equal|strictEqual|notEqual|throws|rejects|pass|fail|plan)\s*\(/g,
  /\bshould\s*\.\s*(?:equal|eql|be\.\w+|not\.\w+|ok|true|false|throw|resolve|reject)\s*\(/g,
];

const TEST_BLOCK_PATTERNS_ = [
  /\bit\s*\(/g,
  /\btest\s*\(/g,
  /\bdescribe\s*\(/g,
  /\btap\.(?:test|pass|fail|ok|notOk|equal|notEqual|deepEqual|notDeepEqual)\s*\(/g,
];

const SNAPSHOT_PATTERNS = [
  /\btoMatchSnapshot\s*\(/g,
  /\btoMatchInlineSnapshot\s*\(/g,
];

const MOCK_PATTERNS_ = [
  /jest\.mock\s*\(/g,
  /vi\.mock\s*\(/g,
  /jest\.spyOn\s*\(/g,
  /vi\.spyOn\s*\(/g,
  /mock\s*\(/g,
  /__mocks__\//,
];

const EXTERNAL_DEP_PATTERNS = [
  /from\s+['"]([^'"]+)(?:\/.*)?['"]/g,
  /require\s*\(\s*['"]([^'"]+)(?:[^'"]*)['"]\s*\)/g,
];

const RELATIVE_IMPORT = /^[./]/;
const BUILTIN_MODULES = [
  "fs", "path", "os", "crypto", "http", "https", "stream",
  "util", "events", "buffer", "child_process", "url", "querystring",
];

// ─── Core Analysis Engine ─────────────────────────────────────

export function findTestFiles(projectRoot: string): string[] {
  const results: string[] = [];
  for (const pattern of TEST_GLOB_PATTERNS) {
    const matches = globSync(pattern, {
      cwd: projectRoot,
      absolute: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/coverage/**"],
    });
    results.push(...matches);
  }
  return [...new Set(results)];
}

export interface TestBlockInfo {
  name: string;
  hasAssertion: boolean;
  isSnapshotOnly: boolean;
  line: number;
}

/**
 * Analyze a single test file for quality metrics.
 */
export function analyzeTestFile(filePath: string, root: string): TestFileAnalysis | null {
  if (!existsSync(filePath)) return null;

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n");
  const relPath = filePath.startsWith(root) ? filePath.slice(root.length + 1) : filePath;

  // Count total assertions
  let assertionCount = 0;
  for (const pattern of ASSERTION_ENTRY_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = content.matchAll(pattern);
    for (const _ of matches) {
      assertionCount++;
    }
  }

  // Count snapshot-only assertions
  let snapshotCount = 0;
  for (const pattern of SNAPSHOT_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = content.matchAll(pattern);
    for (const _ of matches) {
      snapshotCount++;
    }
  }

  // Extract test blocks and check assertions per block
  const testBlocks: TestBlockInfo[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match test/it blocks
    const testMatch = line.match(/\b(it|test)\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (testMatch) {
      testBlocks.push({
        name: testMatch[2],
        hasAssertion: false,
        isSnapshotOnly: false,
        line: i + 1,
      });
    }
  }

  if (testBlocks.length === 0) {
    // Fallback: describe blocks count as test containers
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/\bdescribe\s*\(\s*['"`]([^'"`]+)['"`]/);
      if (match) {
        testBlocks.push({
          name: match[1],
          hasAssertion: false,
          isSnapshotOnly: false,
          line: i + 1,
        });
      }
    }
  }

  // For each test block, check if it contains assertions
  // Simple heuristic: look for assertion patterns in following lines until next test/describe
  for (let i = 0; i < testBlocks.length; i++) {
    const block = testBlocks[i];
    const startLine = block.line - 1; // 0-indexed
    const endLine = i + 1 < testBlocks.length
      ? testBlocks[i + 1].line - 2
      : lines.length;

    const blockContent = lines.slice(startLine, endLine + 1).join("\n");

    for (const pattern of ASSERTION_ENTRY_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(blockContent)) {
        block.hasAssertion = true;
        break;
      }
    }

    // Check if snapshot-only
    let nonSnapshotAssertions = 0;
    let snapAssertions = 0;
    for (const pattern of ASSERTION_ENTRY_PATTERNS) {
      pattern.lastIndex = 0;
      const matches = blockContent.matchAll(pattern);
      for (const match of matches) {
        if (SNAPSHOT_PATTERNS.some((sp) => { sp.lastIndex = 0; return sp.test(match[0]); })) {
          snapAssertions++;
        } else {
          nonSnapshotAssertions++;
        }
      }
    }
    block.isSnapshotOnly = nonSnapshotAssertions === 0 && snapAssertions > 0;
  }

  // Detect mock usage
  const mockCount = content.match(/\b(jest|vi)\.(mock|spyOn|fn)\s*\(/g)?.length ?? 0;
  const hasMocks = mockCount > 0;

  // Detect external dependencies not mocked
  const importedDeps = new Set<string>();
  for (const pattern of EXTERNAL_DEP_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const dep = match[1];
      if (!RELATIVE_IMPORT.test(dep) && !BUILTIN_MODULES.includes(dep)) {
        importedDeps.add(dep);
      }
    }
  }

  const unmockedDeps: string[] = [];
  const mockStatements = content.match(
    /\b(jest|vi)\.mock\s*\(\s*['"`]([^'"`]+)['"`]/g,
  ) ?? [];
  const mockedDeps = new Set(
    mockStatements.map((m) => {
      const match = m.match(/['"`]([^'"`]+)['"`]/);
      return match ? match[1] : "";
    }).filter(Boolean),
  );

  for (const dep of importedDeps) {
    if (!mockedDeps.has(dep)) {
      // Check for manual mock in __mocks__
      const manualMockPath = resolve(filePath.replace(/\/[^/]+$/, `/__mocks__/${dep}.ts`));
      const manualMockJsPath = resolve(filePath.replace(/\/[^/]+$/, `/__mocks__/${dep}.js`));
      if (!existsSync(manualMockPath) && !existsSync(manualMockJsPath)) {
        unmockedDeps.push(dep);
      }
    }
  }

  const noAssertionTests = testBlocks
    .filter((b) => !b.hasAssertion)
    .map((b) => `${b.name} (line ${b.line})`);

  const snapshotOnlyTests = testBlocks
    .filter((b) => b.isSnapshotOnly)
    .map((b) => `${b.name} (line ${b.line})`);

  return {
    file: relPath,
    test_count: testBlocks.length,
    assertion_count: assertionCount,
    no_assertion_tests: noAssertionTests,
    snapshot_only_tests: snapshotOnlyTests,
    unmocked_deps: unmockedDeps,
  };
}

/**
 * Compute composite quality score from all test file analyses.
 */
export function computeQualityScore(
  analyses: TestFileAnalysis[],
): TestQualityMetrics {
  let totalTests = 0;
  let totalAssertions = 0;
  let totalNoAssertion = 0;
  let totalSnapshotOnly = 0;
  const unmockedSet = new Set<string>();

  for (const analysis of analyses) {
    totalTests += analysis.test_count;
    totalAssertions += analysis.assertion_count;
    totalNoAssertion += analysis.no_assertion_tests.length;
    totalSnapshotOnly += analysis.snapshot_only_tests.length;
    for (const dep of analysis.unmocked_deps) {
      unmockedSet.add(dep);
    }
  }

  const assertionDensity = totalTests > 0 ? totalAssertions / totalTests : 0;
  const noAssertionRate = totalTests > 0 ? totalNoAssertion / totalTests : 0;
  const snapshotOnlyRate = totalTests > 0 ? totalSnapshotOnly / totalTests : 0;
  const mockGap = [...unmockedSet];

  // Composite quality score (0-100)
  // Factors: assertion density (target >= 2), no-assertion rate (target 0), snapshot-only rate (target < 0.3)
  const densityScore = Math.min(100, (assertionDensity / 2) * 100);
  const noAssertionPenalty = noAssertionRate * 50; // up to -50
  const snapshotPenalty = Math.min(30, snapshotOnlyRate * 100 * 0.3); // up to -30
  const mockPenalty = Math.min(20, mockGap.length * 5); // -5 per unmocked dep, max -20

  const qualityScore = Math.max(0, Math.round(
    densityScore - noAssertionPenalty - snapshotPenalty - mockPenalty,
  ));

  return {
    total_tests: totalTests,
    tests_without_assertions: totalNoAssertion,
    snapshot_only: totalSnapshotOnly,
    assertion_density: Math.round(assertionDensity * 100) / 100,
    mock_gap: mockGap,
    contract_coverage: 0, // requires design-sheet context, set externally
    quality_score: qualityScore,
  };
}

/**
 * Map design-sheet contracts to test file assertions.
 * Reads the latest design-sheet from .ritsu/ and checks if each contract
 * has a corresponding test assertion.
 */
export function mapContractCoverage(
  projectRoot: string,
  testAnalyses: TestFileAnalysis[],
): ContractMapping[] {
  // Read design-sheet artifacts from .ritsu/
  const ritsuDir = resolve(projectRoot, ".ritsu");
  if (!existsSync(ritsuDir)) return [];

  const designSheets = globSync("design-sheet-*.md", {
    cwd: ritsuDir,
    absolute: true,
  }).sort().reverse(); // latest first

  if (designSheets.length === 0) return [];

  const latestSheet = designSheets[0];
  let content: string;
  try {
    content = readFileSync(latestSheet, "utf-8");
  } catch {
    return [];
  }

  // Extract contracts from design-sheet
  // Format: | C1 | {描述} | {测试文件路径或提示} |
  const contractRegex = /\|\s*(C\d+|OS-\S+)\s*\|\s*([^|]+)\s*\|\s*([^|]*)\s*\|/g;
  const contracts: ContractMapping[] = [];
  let match: RegExpExecArray | null;

  while ((match = contractRegex.exec(content)) !== null) {
    const contractId = match[1].trim();
    const description = match[2].trim();
    const assertionHint = match[3].trim().toLowerCase();

    // Check if any test file contains an assertion matching this contract
    let covered = false;
    const matchingAssertions: string[] = [];

    for (const analysis of testAnalyses) {
      // Check if assertion hint matches the test file path
      if (assertionHint && analysis.file.toLowerCase().includes(assertionHint)) {
        covered = true;
        matchingAssertions.push(analysis.file);
        continue;
      }

      // Check if test file name or content references the contract ID
      if (analysis.file.toLowerCase().includes(contractId.toLowerCase())) {
        covered = true;
        matchingAssertions.push(analysis.file);
      }
    }

    contracts.push({
      contract_id: contractId,
      description,
      covered,
      matching_assertions: matchingAssertions,
    });
  }

  const coveredCount = contracts.filter((c) => c.covered).length;
  const totalCount = contracts.length;

  return contracts.map((c) => ({
    ...c,
    covered: c.covered,
    matching_assertions: c.matching_assertions,
  }));
}

/**
 * Run full test quality analysis for a project.
 * This is the main entry point used by quality gates.
 */
export function runTestQualityAnalysis(
  projectRoot: string,
): TestQualityMetrics {
  const testFiles = findTestFiles(projectRoot);
  const analyses: TestFileAnalysis[] = [];

  for (const file of testFiles) {
    const analysis = analyzeTestFile(file, projectRoot);
    if (analysis) {
      analyses.push(analysis);
    }
  }

  const metrics = computeQualityScore(analyses);

  // Map contract coverage
  const contracts = mapContractCoverage(projectRoot, analyses);
  const coveredContracts = contracts.filter((c) => c.covered).length;
  const totalContracts = contracts.length;
  metrics.contract_coverage = totalContracts > 0
    ? Math.round((coveredContracts / totalContracts) * 100)
    : 0;

  // Recompute quality score with contract coverage factored in
  const contractScore = totalContracts > 0
    ? (coveredContracts / totalContracts) * 20
    : 20; // no contracts = no penalty
  metrics.quality_score = Math.max(0, Math.round(
    metrics.quality_score * 0.8 + contractScore,
  ));

  return metrics;
}
