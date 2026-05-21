import { describe, it, expect } from "vitest";
import type { QualityGateStepStatus } from "../src/quality-gates.js";

describe("quality-gates — pure functions", () => {
  // ─── computeOverallStatus ─────────────────────────────────

  describe("computeOverallStatus", () => {
    it("returns passed when both lint and test pass", async () => {
      const { computeOverallStatus } = await import("../src/quality-gates.js");
      const result = computeOverallStatus("passed", "passed");
      expect(result.passed).toBe(true);
      expect(result.status).toBe("passed");
    });

    it("returns failed when lint fails", async () => {
      const { computeOverallStatus } = await import("../src/quality-gates.js");
      const result = computeOverallStatus("failed", "passed");
      expect(result.passed).toBe(false);
      expect(result.status).toBe("failed");
    });

    it("returns failed when test fails", async () => {
      const { computeOverallStatus } = await import("../src/quality-gates.js");
      const result = computeOverallStatus("passed", "failed");
      expect(result.passed).toBe(false);
      expect(result.status).toBe("failed");
    });

    it("returns partially_skipped when both skipped", async () => {
      const { computeOverallStatus } = await import("../src/quality-gates.js");
      const result = computeOverallStatus("skipped", "skipped");
      expect(result.passed).toBe(false);
      expect(result.status).toBe("partially_skipped");
    });
  });

  // ─── checkVerificationClaims ──────────────────────────────

  describe("checkVerificationClaims", () => {
    it("returns null when tests actually ran", async () => {
      const { checkVerificationClaims } = await import("../src/quality-gates.js");
      const result = checkVerificationClaims({
        lint: { status: "passed", output: "" },
        test: { status: "passed", failures: [], output: "All tests pass" },
      });
      expect(result).toBeNull();
    });

    it("returns warning when tests skipped but output claims passing", async () => {
      const { checkVerificationClaims } = await import("../src/quality-gates.js");
      const result = checkVerificationClaims({
        lint: { status: "skipped", output: "" },
        test: { status: "skipped", failures: [], output: "All tests pass" },
      });
      expect(result).toContain("Unverified claim");
    });

    it("returns null when tests skipped and no verification language", async () => {
      const { checkVerificationClaims } = await import("../src/quality-gates.js");
      const result = checkVerificationClaims({
        lint: { status: "skipped", output: "" },
        test: { status: "skipped", failures: [], output: "" },
      });
      expect(result).toBeNull();
    });

    it("detects Chinese verification claims", async () => {
      const { checkVerificationClaims } = await import("../src/quality-gates.js");
      const result = checkVerificationClaims({
        lint: { status: "skipped", output: "检查全部通过" },
        test: { status: "skipped", failures: [], output: "" },
      });
      expect(result).toContain("Unverified claim");
    });
  });

  // ─── buildQualityGateSnapshot ─────────────────────────────

  describe("buildQualityGateSnapshot", () => {
    it("builds snapshot with all fields", async () => {
      const { buildQualityGateSnapshot } = await import("../src/quality-gates.js");
      const snapshot = buildQualityGateSnapshot({
        context: { skill: "dev", domain: "fullstack" },
        lint: { status: "passed", output: "" },
        test: { status: "passed", failures: [], output: "ok" },
        coverage: {
          summary: { lines: { total: 10, covered: 8, pct: 80 } },
          per_file: {},
        },
      });
      expect(snapshot.passed).toBe(true);
      expect(snapshot.status).toBe("passed");
      expect(snapshot.context?.skill).toBe("dev");
      expect(snapshot.coverage?.summary.lines?.pct).toBe(80);
      expect(snapshot.recorded_at).toBeTruthy();
    });
  });

  // ─── parseQualityGateSnapshot ─────────────────────────────

  describe("parseQualityGateSnapshot", () => {
    it("parses valid JSON snapshot", async () => {
      const { parseQualityGateSnapshot } = await import("../src/quality-gates.js");
      const raw = {
        recorded_at: "20260522-120000",
        passed: true,
        status: "passed",
        lint: { status: "passed", output: "" },
        test: { status: "passed", failures: [], output: "" },
      };
      const result = parseQualityGateSnapshot(raw);
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(true);
      expect(result!.status).toBe("passed");
    });

    it("returns null for non-object", async () => {
      const { parseQualityGateSnapshot } = await import("../src/quality-gates.js");
      expect(parseQualityGateSnapshot(null)).toBeNull();
      expect(parseQualityGateSnapshot("string")).toBeNull();
    });

    it("returns null for missing lint/test", async () => {
      const { parseQualityGateSnapshot } = await import("../src/quality-gates.js");
      expect(parseQualityGateSnapshot({})).toBeNull();
    });

    it("parses coverage from summary or total", async () => {
      const { parseQualityGateSnapshot } = await import("../src/quality-gates.js");
      const usingTotal = parseQualityGateSnapshot({
        lint: { status: "passed", output: "" },
        test: { status: "passed", failures: [], output: "" },
        coverage: {
          total: { lines: { total: 10, covered: 9, pct: 90 } },
          per_file: {},
        },
      });
      expect(usingTotal?.coverage?.summary.lines?.pct).toBe(90);
    });
  });

  // ─── extractQualityGateExecutionContext ───────────────────

  describe("extractQualityGateExecutionContext", () => {
    it("extracts context from params", async () => {
      const { extractQualityGateExecutionContext } = await import("../src/quality-gates.js");
      const result = extractQualityGateExecutionContext({
        skill: "dev",
        trace_id: "trace-abc",
        span_id: "span-123",
      });
      expect(result.skill).toBe("dev");
      expect(result.trace_id).toBe("trace-abc");
      expect(result.span_id).toBe("span-123");
    });

    it("extracts context from nested context field", async () => {
      const { extractQualityGateExecutionContext } = await import("../src/quality-gates.js");
      const result = extractQualityGateExecutionContext({
        context: { skill: "review", correlation_id: "cid-001" },
      });
      expect(result.skill).toBe("review");
      expect(result.correlation_id).toBe("cid-001");
    });

    it("skips empty values", async () => {
      const { extractQualityGateExecutionContext } = await import("../src/quality-gates.js");
      const result = extractQualityGateExecutionContext({ skill: "" });
      expect(result.skill).toBeUndefined();
    });
  });

  // ─── validateQualityGateSnapshotContext ───────────────────

  describe("validateQualityGateSnapshotContext", () => {
    it("passes when no trace context provided", async () => {
      const { validateQualityGateSnapshotContext } = await import("../src/quality-gates.js");
      const result = validateQualityGateSnapshotContext(
        { recorded_at: "", passed: true, status: "passed", lint: { status: "passed", output: "" }, test: { status: "passed", failures: [], output: "" } },
        {},
      );
      expect(result.ok).toBe(true);
    });

    it("fails when snapshot lacks span_id", async () => {
      const { validateQualityGateSnapshotContext } = await import("../src/quality-gates.js");
      const result = validateQualityGateSnapshotContext(
        { recorded_at: "", passed: true, status: "passed", lint: { status: "passed", output: "" }, test: { status: "passed", failures: [], output: "" } },
        { span_id: "span-123" },
      );
      expect(result.ok).toBe(false);
    });

    it("passes when span_id matches", async () => {
      const { validateQualityGateSnapshotContext } = await import("../src/quality-gates.js");
      const result = validateQualityGateSnapshotContext(
        { recorded_at: "", passed: true, status: "passed", context: { span_id: "span-123" }, lint: { status: "passed", output: "" }, test: { status: "passed", failures: [], output: "" } },
        { span_id: "span-123" },
      );
      expect(result.ok).toBe(true);
    });

    it("fails when span_id differs", async () => {
      const { validateQualityGateSnapshotContext } = await import("../src/quality-gates.js");
      const result = validateQualityGateSnapshotContext(
        { recorded_at: "", passed: true, status: "passed", context: { span_id: "span-old" }, lint: { status: "passed", output: "" }, test: { status: "passed", failures: [], output: "" } },
        { span_id: "span-new" },
      );
      expect(result.ok).toBe(false);
    });
  });

  // ─── normalizeQualityGateStatusToken ──────────────────────

  describe("normalizeQualityGateStatusToken", () => {
    it("normalizes status tokens", async () => {
      const { normalizeQualityGateStatusToken, parseQualityGatePct } = await import("../src/quality-gates.js");
      expect(normalizeQualityGateStatusToken("passed")).toBe("passed");
      expect(normalizeQualityGateStatusToken("FAILED")).toBe("failed");
      expect(normalizeQualityGateStatusToken(" 通过 ")).toBe("passed");
      expect(normalizeQualityGateStatusToken(" 部分跳过 ")).toBe("partially_skipped");
      expect(normalizeQualityGateStatusToken("invalid")).toBeNull();
      expect(normalizeQualityGateStatusToken("")).toBeNull();
    });
  });

  // ─── parseQualityGatePct ──────────────────────────────────

  describe("parseQualityGatePct", () => {
    it("parses percentage values", async () => {
      const { parseQualityGatePct } = await import("../src/quality-gates.js");
      expect(parseQualityGatePct("80%")).toBe(80);
      expect(parseQualityGatePct("92.5")).toBe(92.5);
      expect(parseQualityGatePct("abc")).toBeNull();
    });
  });
});
