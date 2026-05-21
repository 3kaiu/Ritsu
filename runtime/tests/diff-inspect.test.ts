import { describe, it, expect } from "vitest";

describe("diff-inspect — pure functions", () => {
  describe("parseStat", () => {
    it("parses git diff --stat output", async () => {
      const { parseStat } = await import("../src/orchestration/diff-inspect.js");
      const result = parseStat("10\t5\tsrc/file.ts\n3\t1\tsrc/other.ts");
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        path: "src/file.ts",
        additions: 10,
        deletions: 5,
        patch_summary: "+10 -5",
      });
      expect(result[1].path).toBe("src/other.ts");
    });

    it("returns empty array for empty input", async () => {
      const { parseStat } = await import("../src/orchestration/diff-inspect.js");
      expect(parseStat("")).toEqual([]);
      expect(parseStat("  \n  ")).toEqual([]);
    });
  });

  describe("parseChunks", () => {
    it("parses diff output into chunks with risk scores", async () => {
      const { parseChunks } = await import("../src/orchestration/diff-inspect.js");
      const diff = `diff --git a/src/a.ts b/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,5 @@
 line1
+export interface User { name: string }
+app.post('/api', handler)
 line2`;
      const chunks = parseChunks(diff);
      expect(chunks.length).toBe(1);
      expect(chunks[0].file).toBe("src/a.ts");
      expect(chunks[0].riskFactors).toContain("type_definition_change");
      expect(chunks[0].riskFactors).toContain("api_signature");
      expect(chunks[0].riskScore).toBeGreaterThanOrEqual(4);
    });

    it("parses multiple files", async () => {
      const { parseChunks } = await import("../src/orchestration/diff-inspect.js");
      const diff = `diff --git a/src/a.ts b/src/a.ts
+++ b/src/a.ts
@@ -1 +1,2 @@
 old
+new
diff --git a/src/b.ts b/src/b.ts
+++ b/src/b.ts
@@ -1 +1,2 @@
 old
+new2`;
      const chunks = parseChunks(diff);
      expect(chunks.length).toBe(2);
    });
  });

  describe("analyzeRisk", () => {
    it("detects auth/security risk", async () => {
      const { analyzeRisk } = await import("../src/orchestration/diff-inspect.js");
      const result = analyzeRisk("src/auth.ts", ["+export function verify(token: string)"]);
      expect(result.factors).toContain("auth_security");
      expect(result.score).toBeGreaterThanOrEqual(4);
    });

    it("detects SQL risk", async () => {
      const { analyzeRisk } = await import("../src/orchestration/diff-inspect.js");
      const result = analyzeRisk("src/db.ts", ["+SELECT * FROM users"]);
      expect(result.factors).toContain("sql_query");
    });

    it("returns score 0 for no risk factors", async () => {
      const { analyzeRisk } = await import("../src/orchestration/diff-inspect.js");
      const result = analyzeRisk("README.md", ["+some text"]);
      expect(result.score).toBe(0);
      expect(result.factors).toEqual([]);
    });
  });

  describe("extractNewIdentifiers", () => {
    it("extracts new function and const declarations", async () => {
      const { extractNewIdentifiers } = await import("../src/orchestration/diff-inspect.js");
      const patch = `+++ b/src/app.ts
+export function handleRequest() {}
+const MAX_RETRIES = 3`;
      const ids = extractNewIdentifiers(patch);
      expect(ids.length).toBe(2);
      expect(ids[0].name).toBe("handleRequest");
      expect(ids[0].file).toBe("src/app.ts");
      expect(ids[1].name).toBe("MAX_RETRIES");
    });

    it("deduplicates same identifier in file", async () => {
      const { extractNewIdentifiers } = await import("../src/orchestration/diff-inspect.js");
      const patch = `+++ b/src/a.ts
+export function foo() {}
+foo()`;
      const ids = extractNewIdentifiers(patch);
      expect(ids.length).toBe(1);
    });
  });
});
