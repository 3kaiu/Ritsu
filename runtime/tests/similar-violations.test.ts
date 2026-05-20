import { describe, expect, it } from "vitest";
import { jaccardSimilarity, findSimilarViolations, loadViolationRecords } from "../src/similar-violations.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("similar-violations", () => {
  it("scores overlapping token sets higher", () => {
    const a = jaccardSimilarity("scope creep out of files", "scope creep extra file");
    const b = jaccardSimilarity("unrelated database migration", "scope creep extra file");
    expect(a).toBeGreaterThan(b);
  });

  it("returns ranked hits", () => {
    const hits = findSimilarViolations(
      [
        { ts: "20260501000000", rule_id: "AP-4", evidence: "scope creep file src/a.ts" },
        { ts: "20260502000000", rule_id: "R-3", evidence: "api_key leaked" },
      ],
      "scope creep",
      5,
    );
    expect(hits[0].rule_id).toBe("AP-4");
  });

  it("correctly loads and filters violation records from jsonl logs", () => {
    const tempDir = resolve("./temp-violations-test");
    if (!existsSync(tempDir)) mkdirSync(tempDir);

    const logPath = resolve(tempDir, "ctx-202605.jsonl");
    const records = [
      {
        ts: "2026-05-15T10:00:00Z",
        status: "violation_detected",
        violation: { rule_id: "AP-4", severity: "fatal", evidence: "scope creep code" }
      },
      {
        ts: "2026-05-20T12:00:00Z",
        status: "violation_detected",
        violation: { rule_id: "AP-2", severity: "warn", evidence: "unused identifier" }
      },
      // Non-violation event should be ignored
      {
        ts: "2026-05-21T12:00:00Z",
        status: "artifact_written"
      }
    ];

    writeFileSync(logPath, records.map(r => JSON.stringify(r)).join("\n"), "utf-8");

    // Check with sinceYyyymmdd = "20260518" (should only load May 20 event, skip May 15)
    const loaded = loadViolationRecords(tempDir, "20260518");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].rule_id).toBe("AP-2");
    expect(loaded[0].evidence).toBe("unused identifier");

    // Clean up
    rmSync(tempDir, { recursive: true, force: true });
  });
});
