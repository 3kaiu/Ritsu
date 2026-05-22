import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { extractHeuristicRules } from "../src/miner.js";
import { ritsu_write_file } from "../src/handlers/write-file.js";
import { ritsu_claim_file } from "../src/handlers/file-lease.js";

describe("Ritsu AST Diff Preference Learning & Merge Proposal Generation", () => {
  let testRoot: string;
  let originalEnvRoot: string | undefined;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-ast-proposal-"));
    originalEnvRoot = process.env.RITSU_PROJECT_ROOT;
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    process.env.RITSU_PROJECT_ROOT = originalEnvRoot;
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should extract pref-prefer-const when parsing let-to-const AST changes", () => {
    const diff = [
      "diff --git a/index.ts b/index.ts",
      "--- a/index.ts",
      "+++ b/index.ts",
      "@@ -1,3 +1,3 @@",
      "-let a = 1;",
      "+const a = 1;",
    ].join("\n");

    const corrections = [{ file: "index.ts", diff }];
    const rules = extractHeuristicRules(corrections);

    expect(rules.length).toBeGreaterThan(0);
    const rule = rules.find((r) => r.id === "pref-prefer-const");
    expect(rule).toBeTruthy();
    expect(rule?.message).toContain("Prefer const over let");
  });

  it("should generate a Merge Proposal at .ritsu/merge_proposal.ts when common dependency types.ts is concurrently modified", async () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir, { recursive: true });

    await ritsu_claim_file({
      path: "src/types.ts",
      span_id: "span-holder",
      ttl_ms: 60000,
    });

    const result = await ritsu_write_file({
      path: "src/types.ts",
      content: "export type Event = 'started' | 'done';",
      span_id: "span-requester",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("❌ [Linter Error]");
    expect(result.content[0].text).toContain("[Merge Proposal]");

    const proposalPath = join(ritsuDir, "merge_proposal.ts");
    expect(existsSync(proposalPath)).toBe(true);
    const proposalContent = readFileSync(proposalPath, "utf-8");
    expect(proposalContent).toContain("Ritsu Merge Proposal");
    expect(proposalContent).toContain("span-holder");
    expect(proposalContent).toContain("span-requester");
  });
});
