import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateCorrelationId, _resetCorrelationCache } from "../src/correlation.js";
import { getCtxPath, ensureCtxFile } from "../src/ctx-path.js";
import { existsSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("correlation", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-correlation-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    ensureCtxFile(testRoot);
    _resetCorrelationCache();
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should generate sequential IDs within a day", async () => {
    const cid1 = generateCorrelationId(testRoot);
    const cid2 = generateCorrelationId(testRoot);
    
    // cid-YYYYMMDD-N
    const parts1 = cid1.split("-");
    const parts2 = cid2.split("-");
    
    expect(parts1[0]).toBe("cid");
    expect(parts1[1]).toBe(parts2[1]); // Same day
    expect(parseInt(parts2[2])).toBe(parseInt(parts1[2]) + 1);
  });

  it("should recover max seq from existing file", async () => {
    const ctxPath = getCtxPath(testRoot);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const fakeEvent = { correlation_id: `cid-${today}-42`, status: "done" };
    writeFileSync(ctxPath, JSON.stringify(fakeEvent) + "\n");

    const nextCid = generateCorrelationId(testRoot);
    expect(nextCid).toBe(`cid-${today}-43`);
  });

  it("should use cache correctly", async () => {
     const cid1 = generateCorrelationId(testRoot);
     // Manual write to file shouldn't affect cache until reset
     const ctxPath = getCtxPath(testRoot);
     const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
     writeFileSync(ctxPath, JSON.stringify({ correlation_id: `cid-${today}-100` }) + "\n", { flag: "a" });
     
     const cid2 = generateCorrelationId(testRoot);
     // Should continue from cid1's cache, not 100
     const seq1 = parseInt(cid1.split("-")[2]);
     const seq2 = parseInt(cid2.split("-")[2]);
     expect(seq2).toBe(seq1 + 1);
     
     // Reset cache should pick up the 100
     _resetCorrelationCache();
     const cid3 = generateCorrelationId(testRoot);
     expect(cid3).toBe(`cid-${today}-101`);
  });
});
