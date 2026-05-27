/**
 * Tests for policy-preflight.ts
 *
 * v8.7.0
 */

import { describe, it, expect } from "vitest";
import {
  parseChangedPaths,
  clearPolicyPreflightCache,
  runPolicyPreflight,
} from "../../src/orchestration/policy-preflight.js";

// ─── parseChangedPaths ──────────────────────────────────────

describe("parseChangedPaths", () => {
  it("should parse normal git diff --stat output", () => {
    const output = " 1 file changed, 42 insertions(+), 3 deletions(-)\n" +
      " 5\t0\tsrc/routes/orders.ts\n" +
      " 2\t1\tsrc/models/order.ts\n";
    const paths = parseChangedPaths(output);
    expect(paths).toEqual(["src/routes/orders.ts", "src/models/order.ts"]);
  });

  it("should return empty array for empty input", () => {
    expect(parseChangedPaths("")).toEqual([]);
  });

  it("should return empty array when no paths match", () => {
    const output = " 1 file changed, 1 insertion(+)\n";
    expect(parseChangedPaths(output)).toEqual([]);
  });

  it("should handle single-file changes", () => {
    const output = " 1\t0\tsrc/index.ts\n";
    const paths = parseChangedPaths(output);
    expect(paths).toEqual(["src/index.ts"]);
  });

  it("should handle files with spaces and special chars", () => {
    const output = " 10\t5\t\"src/my file.test.ts\"\n";
    const paths = parseChangedPaths(output);
    expect(paths.length).toBe(1);
  });
});

// ─── clearPolicyPreflightCache ─────────────────────────────

describe("clearPolicyPreflightCache", () => {
  it("should clear the cache without throwing", () => {
    expect(() => clearPolicyPreflightCache()).not.toThrow();
  });
});

// ─── runPolicyPreflight ────────────────────────────────────

describe("runPolicyPreflight", () => {
  it("should return passed=true for empty workspace", async () => {
    const result = await runPolicyPreflight("/tmp/nonexistent-ritsu-test", "dev");
    expect(result).toBeDefined();
    expect(result.passed).toBe(true);
    expect(result.scan_files).toEqual([]);
    expect(result.diff_bytes).toBe(0);
  });
});
