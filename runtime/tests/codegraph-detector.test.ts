import { describe, it, expect } from "vitest";

describe("codegraph detector", () => {
  it("CodeGraphDetector type is codegraph", async () => {
    const { CodeGraphDetector } = await import("../src/policy/detectors/codegraph.js");
    const detector = new CodeGraphDetector();
    expect(detector.type).toBe("codegraph");
  });

  it("detect returns empty when codegraph CLI unavailable", async () => {
    const { CodeGraphDetector } = await import("../src/policy/detectors/codegraph.js");
    const detector = new CodeGraphDetector();
    const violations = detector.detect(
      { id: "CG-1", name: "test", severity: "warn" },
      {
        action: "write_artifact",
        context: { scan_files: ["src/test.ts"] },
      },
    );
    // No codegraph CLI in test env → graceful empty result
    expect(violations).toEqual([]);
  });

  it("detect returns empty when no scan files in context", async () => {
    const { CodeGraphDetector } = await import("../src/policy/detectors/codegraph.js");
    const detector = new CodeGraphDetector();
    const violations = detector.detect(
      { id: "CG-2", name: "test", severity: "warn" },
      { action: "write_artifact" },
    );
    expect(violations).toEqual([]);
  });

  it("CodeGraphDetector handles CG-2 default case gracefully", async () => {
    const { CodeGraphDetector } = await import("../src/policy/detectors/codegraph.js");
    const detector = new CodeGraphDetector();
    const violations = detector.detect(
      { id: "CG-NONEXISTENT", name: "test", severity: "warn" },
      {
        action: "write_artifact",
        context: { scan_files: ["src/test.ts"] },
      },
    );
    expect(violations).toEqual([]);
  });
});
