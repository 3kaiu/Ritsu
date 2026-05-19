import { describe, expect, it } from "vitest";
import { jaccardSimilarity, findSimilarViolations } from "../src/similar-violations.js";

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
});
