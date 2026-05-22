import { describe, it, expect } from "vitest";
import {
  parseStat,
  analyzeRisk,
  parseChunks,
  extractNewIdentifiers,
} from "../../src/orchestration/diff-inspect.js";

const STAT_OUTPUT = [
  " 3  2 src/foo.ts",
  " 10  0 src/bar.ts",
  " 1  1 src/types.ts",
].join("\n");

describe("parseStat", () => {
  it("parses git diff --stat output", () => {
    const result = parseStat(STAT_OUTPUT);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      path: "src/foo.ts",
      additions: 3,
      deletions: 2,
      patch_summary: "+3 -2",
    });
  });

  it("returns empty array for empty input", () => {
    expect(parseStat("")).toEqual([]);
  });

  it("skips non-matching lines", () => {
    const result = parseStat(" 3 files changed\n 5  5 valid.ts\nsome garbage");
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("valid.ts");
  });
});

describe("analyzeRisk", () => {
  it("detects shared types files", () => {
    const { score, factors } = analyzeRisk("src/types/index.ts", ["+export interface User {"]);
    expect(score).toBeGreaterThanOrEqual(3);
    expect(factors).toContain("shared_types_file");
  });

  it("detects type definition changes", () => {
    const { score, factors } = analyzeRisk("src/foo.ts", ["+export type Status = 'active'"]);
    expect(factors).toContain("type_definition_change");
    expect(score).toBeGreaterThanOrEqual(2);
  });

  it("detects SQL queries", () => {
    const { score, factors } = analyzeRisk("src/repo.ts", ["+  SELECT * FROM users"]);
    expect(factors).toContain("sql_query");
    expect(score).toBeGreaterThanOrEqual(3);
  });

  it("does not flag SQL in markdown files", () => {
    const { factors } = analyzeRisk("docs/README.md", ["SELECT * FROM users"]);
    expect(factors).not.toContain("sql_query");
  });

  it("detects auth/security changes", () => {
    const { score, factors } = analyzeRisk("src/auth/login.ts", ["+export function verify() {"]);
    expect(factors).toContain("auth_security");
    expect(score).toBeGreaterThanOrEqual(4);
  });

  it("detects exported functions", () => {
    const { factors } = analyzeRisk("src/api.ts", ["+export function handler() {"]);
    expect(factors).toContain("api_signature");
  });

  it("returns zero score for benign changes", () => {
    const { score, factors } = analyzeRisk("src/utils.ts", ["+const msg = 'hello'"]);
    expect(score).toBe(0);
    expect(factors).toEqual([]);
  });

  it("accumulates multiple risk factors", () => {
    const { score, factors } = analyzeRisk("src/auth/login.ts", [
      "+export function verify() {",
      "+  const result = await db.query('SELECT * FROM users')",
    ]);
    expect(factors).toContain("auth_security");
    expect(factors).toContain("sql_query");
    expect(score).toBeGreaterThanOrEqual(7);
  });
});

const DIFF_OUTPUT = [
  "diff --git a/src/foo.ts b/src/foo.ts",
  "--- a/src/foo.ts",
  "+++ b/src/foo.ts",
  "@@ -1,3 +1,5 @@",
  "+export const newFunc = () => {}",
  " unchanged line",
  "-old line",
  "diff --git a/src/auth/login.ts b/src/auth/login.ts",
  "--- a/src/auth/login.ts",
  "+++ b/src/auth/login.ts",
  "@@ -10,4 +10,6 @@",
  "+export function verifyToken() {",
  "+  const q = 'SELECT * FROM sessions'",
].join("\n");

describe("parseChunks", () => {
  it("parses diff output into scored chunks", () => {
    const chunks = parseChunks(DIFF_OUTPUT);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].file).toBe("src/foo.ts");
    expect(chunks[0].hunkHeader).toContain("@@");
  });

  it("assigns risk scores to chunks", () => {
    const chunks = parseChunks(DIFF_OUTPUT);
    for (const c of chunks) {
      expect(typeof c.riskScore).toBe("number");
      expect(Array.isArray(c.riskFactors)).toBe(true);
    }
  });

  it("includes risk factors for relevant chunks", () => {
    const chunks = parseChunks(DIFF_OUTPUT);
    const authChunk = chunks.find((c) => c.file.includes("auth/login"));
    expect(authChunk).toBeDefined();
    expect(authChunk!.riskScore).toBeGreaterThanOrEqual(4);
  });

  it("returns empty for no diff", () => {
    expect(parseChunks("")).toEqual([]);
  });

  it("ignores lines before the first hunk", () => {
    const chunks = parseChunks("diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n+hello");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("+hello");
  });
});

const PATCH_OUTPUT = [
  "diff --git a/src/api.ts b/src/api.ts",
  "--- a/src/api.ts",
  "+++ b/src/api.ts",
  "@@ -1 +1,3 @@",
  "+export function newHandler() {}",
  "+export const API_PREFIX = '/v2'",
  "+const internal = 42",
].join("\n");

describe("extractNewIdentifiers", () => {
  it("extracts newly added declarations", () => {
    const ids = extractNewIdentifiers(PATCH_OUTPUT);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const names = ids.map((i) => i.name);
    expect(names).toContain("newHandler");
    expect(names).toContain("API_PREFIX");
  });

  it("finds new declarations including non-exported ones", () => {
    const ids = extractNewIdentifiers(PATCH_OUTPUT);
    const names = ids.map((i) => i.name);
    // internal is matched by the const pattern
    expect(names).toContain("internal");
  });

  it("handles removal-only diffs (no new lines with +)", () => {
    const ids = extractNewIdentifiers(
      "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-export const x = 1\n export const x = 2",
    );
    // No lines starting with + → no identifiers
    expect(ids).toEqual([]);
  });

  it("deduplicates same identifier in same file", () => {
    const dup =
      "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,3 +1,3 @@\n+export const x = 1\n+export const x = 2";
    const ids = extractNewIdentifiers(dup);
    const xCount = ids.filter((i) => i.name === "x").length;
    expect(xCount).toBe(1);
  });
});
