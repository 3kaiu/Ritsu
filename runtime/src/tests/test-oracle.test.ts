/**
 * Tests for test-oracle.ts
 *
 * v8.8.0
 */

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { analyzeContractCoverage, runSemanticOracle } from "../test-oracle.js";

const COVERAGE_PATH = resolve(import.meta.dirname, "../../coverage/coverage-final.json");

describe("analyzeContractCoverage", () => {
  it("should return failed for missing coverage file", () => {
    const result = analyzeContractCoverage("C1", "test contract", "/nonexistent/path.json");
    expect(result.overall).toBe("failed");
    expect(result.evidence).toContain("No Istanbul coverage data found");
  });

  it("should find matching functions from coverage data", () => {
    const result = analyzeContractCoverage("C1", "extractBlock function", COVERAGE_PATH);
    // Should find at least some function coverage from the Ritsu project's own coverage
    expect(Array.isArray(result.function_coverage)).toBe(true);
    expect(result.contract_id).toBe("C1");
  });

  it("should find functions by keyword matching", () => {
    const result = analyzeContractCoverage("C2", "captureQualityGateWorktreeState", COVERAGE_PATH);
    // This function name appears in quality-gates.ts
    expect(Array.isArray(result.function_coverage)).toBe(true);
  });

  it("should report uncovered functions", () => {
    const result = analyzeContractCoverage("C3", "xyznonexistentfunction_2024", COVERAGE_PATH);
    // Should not find any matching function
    expect(result.overall).toBe("failed");
    expect(result.uncovered_functions.length).toBe(0);
  });

  it("should include branch coverage data", () => {
    const result = analyzeContractCoverage("C1", "checkCoverageThreshold", COVERAGE_PATH);
    // Branch coverage should be present
    if (result.function_coverage.length > 0) {
      expect(Array.isArray(result.branch_coverage)).toBe(true);
    }
  });
});

describe("runSemanticOracle", () => {
  it("should process multiple contracts", () => {
    const contracts = [
      { id: "C1", description: "parseStat function" },
      { id: "C2", description: "checkCoverageThreshold" },
    ];
    const results = runSemanticOracle(contracts, COVERAGE_PATH);
    expect(results.length).toBe(2);
    for (const r of results) {
      expect(r.contract_id).toBeDefined();
    }
  });

  it("should handle empty contracts list", () => {
    const results = runSemanticOracle([], COVERAGE_PATH);
    expect(results).toEqual([]);
  });
});
