/**
 * Tests for violation-tracker.ts
 *
 * v8.4.0
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync, mkdtempSync } from "node:fs";

import {
  captureViolation,
  resolveViolation,
  resolveViolationsByRule,
  getOpenViolations,
  getViolationsByFile,
  getViolationTrend,
  queryViolations,
  readStore,
} from "../violation-tracker.js";

describe("ViolationTracker", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ritsu-test-vt-"));
    mkdirSync(join(tmpDir, ".ritsu"), { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── Capture ───────────────────────────────────────────────

  it("should capture a violation", () => {
    const v = captureViolation(tmpDir, {
      rule_id: "AP-4",
      severity: "error",
      message: "Scope creep detected",
      evidence: "src/auth.ts:42 — added unauthorized feature",
      trace_id: "trace-test-1",
    });

    expect(v.id).toMatch(/^v-/);
    expect(v.rule_id).toBe("AP-4");
    expect(v.status).toBe("open");
    expect(v.file).toBe("src/auth.ts");
    expect(v.trace_id).toBe("trace-test-1");
  });

  it("should deduplicate identical violations", () => {
    const v1 = captureViolation(tmpDir, {
      rule_id: "AP-4",
      severity: "error",
      message: "Scope creep detected",
      evidence: "src/auth.ts:42 — added unauthorized feature",
    });

    const v2 = captureViolation(tmpDir, {
      rule_id: "AP-4",
      severity: "error",
      message: "Scope creep detected",
      evidence: "src/auth.ts:99 — another unauthorized change",
    });

    // Should be the same violation (dedup by rule_id + file + message)
    expect(v2.id).toBe(v1.id);
  });

  it("should capture distinct violations separately", () => {
    const v1 = captureViolation(tmpDir, {
      rule_id: "R-3",
      severity: "hard_stop",
      message: "Hardcoded credential in config",
      evidence: "src/config.ts:12 — api_key",
    });

    const v2 = captureViolation(tmpDir, {
      rule_id: "AP-4",
      severity: "error",
      message: "Different file scope creep",
      evidence: "src/routes/orders.ts:25 — unrelated change",
    });

    expect(v1.id).not.toBe(v2.id);
    expect(v1.file).toBe("src/config.ts");
    expect(v2.file).toBe("src/routes/orders.ts");
  });

  // ─── Lifecycle ─────────────────────────────────────────────

  it("should resolve a violation", () => {
    const v = captureViolation(tmpDir, {
      rule_id: "R-6",
      severity: "fatal",
      message: "SQL injection risk",
      evidence: "src/db.ts:55 — string interpolation",
    });

    const ok = resolveViolation(tmpDir, v.id, "fixed");
    expect(ok).toBe(true);
    // Read from store to confirm (local object not updated)
    const store = readStore(tmpDir);
    const stored = store.violations.find((sv) => sv.id === v.id);
    expect(stored?.status).toBe("fixed");
    expect(stored?.resolved_at).toBeDefined();
  });

  it("should return false for non-existent violation", () => {
    const ok = resolveViolation(tmpDir, "nonexistent", "fixed");
    expect(ok).toBe(false);
  });

  it("should bulk-resolve by rule ID", () => {
    // Create two violations with same rule
    captureViolation(tmpDir, {
      rule_id: "AP-13",
      severity: "warn",
      message: "console.log left in production code",
      evidence: "src/utils.ts:10 — debug log",
    });
    captureViolation(tmpDir, {
      rule_id: "AP-13",
      severity: "warn",
      message: "debugger statement",
      evidence: "src/app.ts:5 — debugger",
    });

    const count = resolveViolationsByRule(tmpDir, "AP-13");
    expect(count).toBe(2);

    const open = getOpenViolations(tmpDir);
    const ap13 = open.filter((v) => v.rule_id === "AP-13");
    expect(ap13.length).toBe(0);
  });

  // ─── Queries ───────────────────────────────────────────────

  it("should return open violations", () => {
    const open = getOpenViolations(tmpDir);
    expect(Array.isArray(open)).toBe(true);
    for (const v of open) {
      expect(["open", "acknowledged"]).toContain(v.status);
    }
  });

  it("should filter by rule_id", () => {
    const filtered = queryViolations(tmpDir, { rule_id: "AP-4" });
    for (const v of filtered) {
      expect(v.rule_id).toBe("AP-4");
    }
  });

  it("should group by file", () => {
    const byFile = getViolationsByFile(tmpDir);
    // All returned keys should have violations
    for (const [, violations] of Object.entries(byFile)) {
      expect(violations.length).toBeGreaterThan(0);
    }
  });

  it("should provide trend data", () => {
    const trend = getViolationTrend(tmpDir);
    expect(trend.length).toBeGreaterThanOrEqual(1);
    const latest = trend[trend.length - 1];
    expect(latest.opened).toBeGreaterThan(0);
  });

  // ─── Edge Cases ────────────────────────────────────────────

  it("should handle empty store", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "ritsu-test-vt-empty-"));
    const open = getOpenViolations(emptyDir);
    expect(open).toEqual([]);

    const trend = getViolationTrend(emptyDir);
    expect(trend).toEqual([]);

    rmSync(emptyDir, { recursive: true, force: true });
  });
});
