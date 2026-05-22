import { describe, it, expect } from "vitest";
import {
  computeOverallStatus,
  normalizeQualityGateStatusToken,
  parseQualityGatePct,
  assessRiskLevel,
  getCoverageThreshold,
  checkCoverageThreshold,
  checkVerificationClaims,
  validateQualityGateSnapshotContext,
  extractQualityGateExecutionContext,
  buildQualityGateSnapshot,
  parseQualityGateSnapshot,
} from "../src/quality-gates.js";

describe("computeOverallStatus", () => {
  it("passes when both pass", () => {
    expect(computeOverallStatus("passed", "passed")).toEqual({ passed: true, status: "passed" });
  });

  it("fails when lint fails", () => {
    expect(computeOverallStatus("failed", "passed")).toEqual({ passed: false, status: "failed" });
  });

  it("partially_skipped when lint skipped, test passed", () => {
    const r = computeOverallStatus("skipped", "passed");
    expect(r.status).toBe("partially_skipped");
  });

  it("passed when test passed and lint passed", () => {
    expect(computeOverallStatus("passed", "passed").passed).toBe(true);
  });
});

describe("normalizeQualityGateStatusToken", () => {
  it("normalizes chinese to english", () => {
    expect(normalizeQualityGateStatusToken("通过")).toBe("passed");
    expect(normalizeQualityGateStatusToken("失败")).toBe("failed");
    expect(normalizeQualityGateStatusToken("跳过")).toBe("skipped");
  });

  it("preserves english tokens", () => {
    expect(normalizeQualityGateStatusToken("passed")).toBe("passed");
  });

  it("returns null for unknown tokens", () => {
    expect(normalizeQualityGateStatusToken("unknown")).toBeNull();
  });
});

describe("parseQualityGatePct", () => {
  it("parses percentages", () => {
    expect(parseQualityGatePct("85.5%")).toBe(85.5);
    expect(parseQualityGatePct("100%")).toBe(100);
  });

  it("returns null for non-numeric", () => {
    expect(parseQualityGatePct("N/A")).toBeNull();
  });
});

describe("assessRiskLevel", () => {
  it("auth → core", () => {
    expect(assessRiskLevel(["src/auth/login.ts"])).toBe("core");
  });
  it("payment → core", () => {
    expect(assessRiskLevel(["src/payment/checkout.ts"])).toBe("core");
  });
  it("crypto → core", () => {
    expect(assessRiskLevel(["lib/crypto/encrypt.ts"])).toBe("core");
  });
  it("types → core", () => {
    expect(assessRiskLevel(["src/types/index.ts"])).toBe("core");
  });
  it("middleware → core", () => {
    expect(assessRiskLevel(["src/middleware/auth.ts"])).toBe("core");
  });
  it(".d.ts → core", () => {
    expect(assessRiskLevel(["src/api.d.ts"])).toBe("core");
  });
  it("routes file → core", () => {
    expect(assessRiskLevel(["src/routes/users.ts"])).toBe("core");
  });
  it("utils → periphery", () => {
    expect(assessRiskLevel(["src/utils/format.ts"])).toBe("periphery");
  });
  it("one core file contaminates the list", () => {
    expect(assessRiskLevel(["src/utils/x.ts", "src/auth/login.ts"])).toBe("core");
  });
});

describe("getCoverageThreshold", () => {
  it("core => 100", () => expect(getCoverageThreshold("core")).toBe(100));
  it("periphery => -1", () => expect(getCoverageThreshold("periphery")).toBe(-1));
});

describe("checkCoverageThreshold", () => {
  it("passes when met", () => {
    expect(checkCoverageThreshold(100, 100)).toBe(true);
  });
  it("fails when below", () => {
    expect(checkCoverageThreshold(79, 80)).toBe(false);
  });
  it("always passes with negative threshold", () => {
    expect(checkCoverageThreshold(0, -1)).toBe(true);
    expect(checkCoverageThreshold(undefined, -1)).toBe(true);
  });
  it("fails with undefined pct and positive threshold", () => {
    expect(checkCoverageThreshold(undefined, 80)).toBe(false);
  });
});

describe("checkVerificationClaims", () => {
  it("null when tests actually ran", () => {
    expect(checkVerificationClaims({
      lint: { status: "passed", output: "clean" },
      test: { status: "passed", failures: [], output: "3 passed" },
    })).toBeNull();
  });

  it("detects unverified 'passed' claim when skipped", () => {
    const r = checkVerificationClaims({
      lint: { status: "skipped", output: "" },
      test: { status: "skipped", failures: [], output: "all tests passed!" },
    });
    expect(r).toContain("Unverified claim");
  });

  it("detects chinese verification claims", () => {
    const r = checkVerificationClaims({
      lint: { status: "skipped", output: "" },
      test: { status: "skipped", failures: [], output: "测试全部通过" },
    });
    expect(r).toContain("Unverified claim");
  });

  it("detects 'verified' keyword claims", () => {
    const r = checkVerificationClaims({
      lint: { status: "skipped", output: "" },
      test: { status: "skipped", failures: [], output: "verified manually" },
    });
    expect(r).toContain("Unverified claim");
  });
});

describe("validateQualityGateSnapshotContext", () => {
  const snap = {
    recorded_at: "20260522-120000",
    passed: true,
    status: "passed" as const,
    lint: { status: "passed" as const, output: "" },
    test: { status: "passed" as const, failures: [], output: "" },
  };

  it("ok when no context at all", () => {
    expect(validateQualityGateSnapshotContext({ ...snap }, {}).ok).toBe(true);
  });

  it("ok when span_id matches", () => {
    const r = validateQualityGateSnapshotContext(
      { ...snap, context: { span_id: "span-abc12345" } },
      { span_id: "span-abc12345" },
    );
    expect(r.ok).toBe(true);
  });

  it("fails when span_id mismatches", () => {
    const r = validateQualityGateSnapshotContext(
      { ...snap, context: { span_id: "span-a" } },
      { span_id: "span-b" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.expected).toContain("span_id: span-b");
  });

  it("fails when snapshot missing span_id", () => {
    const r = validateQualityGateSnapshotContext(
      { ...snap, context: {} },
      { span_id: "span-abc" },
    );
    expect(r.ok).toBe(false);
  });

  it("ok when trace_id matches", () => {
    const r = validateQualityGateSnapshotContext(
      { ...snap, context: { trace_id: "tr-20260522-ab" } },
      { trace_id: "tr-20260522-ab" },
    );
    expect(r.ok).toBe(true);
  });

  it("fails when snapshot has no trace_id but current does", () => {
    const r = validateQualityGateSnapshotContext(
      { ...snap, context: { span_id: "span-123" } },
      { trace_id: "tr-abc", span_id: "span-123" },
    );
    expect(r.ok).toBe(false);
  });

  it("falls back to correlation_id", () => {
    const r = validateQualityGateSnapshotContext(
      { ...snap, context: { correlation_id: "cid-001" } },
      { correlation_id: "cid-001" },
    );
    expect(r.ok).toBe(true);
  });
});

describe("extractQualityGateExecutionContext", () => {
  it("extracts from top-level params", () => {
    const ctx = extractQualityGateExecutionContext({
      trace_id: "trace-abc",
      skill: "dev",
    });
    expect(ctx.trace_id).toBe("trace-abc");
    expect(ctx.skill).toBe("dev");
  });

  it("extracts from nested context object", () => {
    const ctx = extractQualityGateExecutionContext({
      context: { trace_id: "trace-xyz" },
    });
    expect(ctx.trace_id).toBe("trace-xyz");
  });

  it("empty for no params", () => {
    expect(Object.keys(extractQualityGateExecutionContext({})).length).toBe(0);
  });
});

describe("buildQualityGateSnapshot", () => {
  it("builds basic snapshot", () => {
    const s = buildQualityGateSnapshot({
      lint: { status: "passed", output: "ok" },
      test: { status: "passed", failures: [], output: "3 passed" },
    });
    expect(s.passed).toBe(true);
    expect(s.recorded_at).toBeTruthy();
  });

  it("includes coverage when provided", () => {
    const s = buildQualityGateSnapshot({
      lint: { status: "passed", output: "" },
      test: { status: "passed", failures: [], output: "" },
      coverage: {
        summary: { lines: { total: 100, covered: 85, pct: 85 } },
        per_file: {},
      },
    });
    expect(s.coverage?.summary.lines?.pct).toBe(85);
  });

  it("records verification_warning when claims detected", () => {
    const s = buildQualityGateSnapshot({
      lint: { status: "skipped", output: "" },
      test: { status: "skipped", failures: [], output: "测试全部通过" },
    });
    expect(s.verification_warning).toBeDefined();
  });
});

describe("parseQualityGateSnapshot", () => {
  it("parses well-formed snapshot", () => {
    const raw = {
      recorded_at: "20260522-120000",
      passed: true,
      status: "passed",
      lint: { status: "passed", output: "" },
      test: { status: "passed", failures: [], output: "" },
    };
    expect(parseQualityGateSnapshot(raw)).not.toBeNull();
  });

  it("returns null for missing required fields", () => {
    expect(parseQualityGateSnapshot({})).toBeNull();
    expect(parseQualityGateSnapshot({ lint: null, test: null })).toBeNull();
  });

  it("parses coverage when present", () => {
    const raw = {
      recorded_at: "20260522-120000",
      passed: true,
      status: "passed",
      lint: { status: "passed", output: "" },
      test: { status: "passed", failures: [], output: "" },
      coverage: {
        summary: { lines: { total: 100, covered: 90, pct: 90 } },
        per_file: {},
      },
    };
    expect(parseQualityGateSnapshot(raw)!.coverage?.summary.lines?.pct).toBe(90);
  });
});
