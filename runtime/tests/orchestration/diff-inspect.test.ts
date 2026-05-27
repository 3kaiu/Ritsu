import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseStat,
  analyzeRisk,
  parseChunks,
  extractNewIdentifiers,
  inspectDiff,
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

  it("extracts async function declarations", () => {
    const patch = "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n+export async function fetchData() {}";
    const ids = extractNewIdentifiers(patch);
    const names = ids.map((i) => i.name);
    expect(names).toContain("fetchData");
  });

  it("extracts class declarations", () => {
    const patch = "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n+export class UserService {}";
    const ids = extractNewIdentifiers(patch);
    const names = ids.map((i) => i.name);
    expect(names).toContain("UserService");
  });

  it("extracts interface declarations", () => {
    const patch = "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n+export interface User {}";
    const ids = extractNewIdentifiers(patch);
    const names = ids.map((i) => i.name);
    expect(names).toContain("User");
  });

  it("deduplicates same identifier in same file", () => {
    const dup =
      "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,3 +1,3 @@\n+export const x = 1\n+export const x = 2";
    const ids = extractNewIdentifiers(dup);
    const xCount = ids.filter((i) => i.name === "x").length;
    expect(xCount).toBe(1);
  });
});

// ─── inspectDiff (mock-based) ─────────────────────────────────

describe("inspectDiff", () => {
  const MOCK_STAT = " 1\t0\tsrc/test.ts\n";
  const MOCK_PATCH = "diff --git a/src/test.ts b/src/test.ts\n--- a/src/test.ts\n+++ b/src/test.ts\n@@ -1 +1,3 @@\n+export const foo = 1\n+export function bar() {}\n";

  beforeEach(async () => {
    // Mock _git-utils to return controlled data
    const gitMock = await import("../../src/handlers/_git-utils.js");
    vi.spyOn(gitMock, "runGit").mockImplementation(
      async (_args: string[], _root: string) => {
        const args = Array.isArray(_args) ? _args : [];
        if (args.includes("--stat")) {
          return { ok: true, output: MOCK_STAT };
        }
        return { ok: true, output: MOCK_PATCH };
      },
    );
  });

  it("returns stat mode data", async () => {
    const result = await inspectDiff({
      projectRoot: "/tmp/test",
      mode: "stat",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as Record<string, unknown>).mode).toBe("stat");
      expect((result.data as Record<string, unknown>).total_files).toBe(1);
    }
  });

  it("returns chunks mode with risk scores", async () => {
    const result = await inspectDiff({
      projectRoot: "/tmp/test",
      mode: "chunks",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as Record<string, unknown>;
      expect(data.mode).toBe("chunks");
      expect(data.total_chunks).toBeGreaterThanOrEqual(1);
    }
  });

  it("slices chunks by topN", async () => {
    const result = await inspectDiff({
      projectRoot: "/tmp/test",
      mode: "chunks",
      topN: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const chunks = (result.data as Record<string, unknown>).chunks as unknown[];
      expect(chunks.length).toBeLessThanOrEqual(1);
    }
  });

  it("returns full mode data", async () => {
    const result = await inspectDiff({
      projectRoot: "/tmp/test",
      mode: "full",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as Record<string, unknown>;
      expect(data.mode).toBe("full");
      expect(data.files).toBeDefined();
      expect(data.new_identifiers).toBeDefined();
      expect(data.diff).toBeDefined();
    }
  });

  it("truncates output in full mode when maxOutputLines exceeded", async () => {
    const result = await inspectDiff({
      projectRoot: "/tmp/test",
      mode: "full",
      maxOutputLines: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as Record<string, unknown>;
      expect(data.truncated).toBe(true);
      expect((data.diff as string)).toContain("diff truncated");
    }
  });

  it("returns error when stat git fails", async () => {
    const gitMock = await import("../../src/handlers/_git-utils.js");
    vi.spyOn(gitMock, "runGit").mockImplementation(
      async () => ({ ok: false, output: "fatal: not a git repository" }),
    );

    const result = await inspectDiff({
      projectRoot: "/tmp/test",
      mode: "stat",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("git diff --stat failed");
    }
  });

  it("supports cached mode", async () => {
    const gitMock = await import("../../src/handlers/_git-utils.js");
    let usedCached = false;
    vi.spyOn(gitMock, "runGit").mockImplementation(
      async (args: string[], _root: string) => {
        if (args.includes("--cached")) usedCached = true;
        return { ok: true, output: MOCK_PATCH };
      },
    );

    await inspectDiff({ projectRoot: "/tmp/test", mode: "chunks", cached: true });
    expect(usedCached).toBe(true);
  });
});
