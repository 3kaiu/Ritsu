/**
 * Tests for test-intelligence.ts
 *
 * v8.1.0
 */

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findTestFiles,
  analyzeTestFile,
  computeQualityScore,
  runTestQualityAnalysis,
  type TestFileAnalysis,
} from "../test-intelligence.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

// ─── findTestFiles ───────────────────────────────────────────

describe("findTestFiles", () => {
  it("should return an array of existing test files", () => {
    const files = findTestFiles(PROJECT_ROOT);
    expect(Array.isArray(files)).toBe(true);
    expect(files.length).toBeGreaterThan(0);
    // At least our own test file should be found
    const selfTest = files.find((f) => f.includes("test-intelligence.test.ts"));
    expect(selfTest).toBeTruthy();
  });

  it("should not include node_modules files", () => {
    const files = findTestFiles(PROJECT_ROOT);
    const hasNodeModules = files.some((f) => f.includes("node_modules"));
    expect(hasNodeModules).toBe(false);
  });
});

// ─── analyzeTestFile ─────────────────────────────────────────

describe("analyzeTestFile", () => {
  it("should return null for non-existent file", () => {
    const result = analyzeTestFile("/nonexistent/path.ts", PROJECT_ROOT);
    expect(result).toBeNull();
  });

  it("should return valid analysis for an existing test file", () => {
    // Analyze our own test file
    const ourPath = resolve(
      PROJECT_ROOT,
      "tests",
      "test-intelligence.test.ts",
    );
    const result = analyzeTestFile(ourPath, PROJECT_ROOT);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.file).toContain("test-intelligence.test.ts");
    expect(result.test_count).toBeGreaterThan(0);
    expect(result.assertion_count).toBeGreaterThan(0);
  });

  it("should detect no-assertion tests when present", () => {
    // Create a synthetic test content
    const fakeContent = `
      describe("fake suite", () => {
        it("has no assertion", () => {
          const x = 1;
        });

        it("has assertion", () => {
          expect(x).toBe(1);
        });
      });
    `;

    // Write to temp file and analyze
    const tmpDir = mkdtempSync(join(tmpdir(), "ritsu-test-"));
    const tmpFile = join(tmpDir, "fake.test.ts");
    writeFileSync(tmpFile, fakeContent, "utf-8");

    const result = analyzeTestFile(tmpFile, tmpDir);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.no_assertion_tests.length).toBe(1);
    expect(result.no_assertion_tests[0]).toContain("has no assertion");
    expect(result.assertion_count).toBe(1);
  });
});

// ─── computeQualityScore ─────────────────────────────────────

describe("computeQualityScore", () => {
  it("should return defaults for empty analysis", () => {
    const metrics = computeQualityScore([]);
    expect(metrics.total_tests).toBe(0);
    expect(metrics.assertion_density).toBe(0);
    expect(metrics.quality_score).toBe(0);
  });

  it("should compute 100 score for perfect tests", () => {
    const analyses: TestFileAnalysis[] = [
      {
        file: "perfect.test.ts",
        test_count: 5,
        assertion_count: 15,
        no_assertion_tests: [],
        snapshot_only_tests: [],
        unmocked_deps: [],
      },
    ];
    const metrics = computeQualityScore(analyses);
    expect(metrics.total_tests).toBe(5);
    expect(metrics.assertion_density).toBeGreaterThanOrEqual(3);
    expect(metrics.quality_score).toBeGreaterThanOrEqual(90);
  });

  it("should penalize no-assertion tests", () => {
    const good: TestFileAnalysis[] = [
      {
        file: "good.test.ts",
        test_count: 5,
        assertion_count: 10,
        no_assertion_tests: [],
        snapshot_only_tests: [],
        unmocked_deps: [],
      },
    ];
    const bad: TestFileAnalysis[] = [
      {
        file: "bad.test.ts",
        test_count: 5,
        assertion_count: 0,
        no_assertion_tests: ["empty test"],
        snapshot_only_tests: [],
        unmocked_deps: [],
      },
    ];

    const goodScore = computeQualityScore(good).quality_score;
    const badScore = computeQualityScore(bad).quality_score;
    expect(goodScore).toBeGreaterThan(badScore);
  });

  it("should penalize snapshot-only tests", () => {
    const analyses: TestFileAnalysis[] = [
      {
        file: "snap.test.ts",
        test_count: 3,
        assertion_count: 3,
        no_assertion_tests: [],
        snapshot_only_tests: ["should render (line 5)"],
        unmocked_deps: [],
      },
    ];
    const metrics = computeQualityScore(analyses);
    expect(metrics.snapshot_only).toBe(1);
    // quality should be reduced due to snapshot-only
    expect(metrics.quality_score).toBeLessThan(90);
  });

  it("should penalize unmocked dependencies", () => {
    const analyses: TestFileAnalysis[] = [
      {
        file: "leaky.test.ts",
        test_count: 2,
        assertion_count: 4,
        no_assertion_tests: [],
        snapshot_only_tests: [],
        unmocked_deps: ["axios", "database"],
      },
    ];
    const metrics = computeQualityScore(analyses);
    expect(metrics.mock_gap).toContain("axios");
    expect(metrics.mock_gap).toContain("database");
  });
});

// ─── runTestQualityAnalysis ──────────────────────────────────

describe("runTestQualityAnalysis", () => {
  it("should run without error on the Ritsu project", () => {
    const metrics = runTestQualityAnalysis(PROJECT_ROOT);
    expect(metrics).toBeDefined();
    expect(typeof metrics.total_tests).toBe("number");
    expect(typeof metrics.quality_score).toBe("number");
    // Should have found tests
    expect(metrics.total_tests).toBeGreaterThan(0);
    // assertion density should be >= 0
    expect(metrics.assertion_density).toBeGreaterThanOrEqual(0);
    // quality score should be 0-100
    expect(metrics.quality_score).toBeGreaterThanOrEqual(0);
    expect(metrics.quality_score).toBeLessThanOrEqual(100);
  });
});
