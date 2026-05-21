import { describe, it, expect } from "vitest";

describe("write-artifact — validation functions", () => {
  describe("buildArtifactSummary", () => {
    it("extracts summary from content", async () => {
      const { buildArtifactSummary } = await import("../src/handlers/write-artifact.js");
      const result = buildArtifactSummary("design title\n\ncontent");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("handles empty content", async () => {
      const { buildArtifactSummary } = await import("../src/handlers/write-artifact.js");
      // Empty content returns the default status string
      const result = buildArtifactSummary("");
      expect(typeof result).toBe("string");
    });
  });

  describe("buildArtifactValidationViolation", () => {
    it("builds violation with required fields", async () => {
      const { buildArtifactValidationViolation } = await import("../src/handlers/write-artifact.js");
      const violation = buildArtifactValidationViolation({
        code: "missing_contract",
        severity: "error",
        path: "content",
        message: "Contract section is required",
      });
      expect(violation.code).toBe("missing_contract");
      expect(violation.severity).toBe("error");
      expect(violation.message).toBe("Contract section is required");
    });
  });

  describe("buildArtifactValidationViolations", () => {
    it("builds violations from issues", async () => {
      const { buildArtifactValidationViolations, buildArtifactValidationViolation } = await import("../src/handlers/write-artifact.js");
      const issues: Array<{ code: string; severity: string; path: string; message: string }> = [];
      const result = buildArtifactValidationViolations(issues);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });
});
