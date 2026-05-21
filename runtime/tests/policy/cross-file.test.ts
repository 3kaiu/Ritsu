import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { PolicyRule } from "../../src/policy/types.js";

describe("CrossFileDetector", () => {
  let testRoot: string;
  const rule: PolicyRule = {
    id: "AP-CROSS-FILE",
    name: "Cross-file version drift",
    severity: "error",
    detector: { type: "cross_file" },
  };

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-cross-file-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    delete process.env.RITSU_PROJECT_ROOT;
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  it("returns no violations when versions match", async () => {
    const { CrossFileDetector } = await import("../../src/policy/detectors/cross-file.js");
    writeFileSync(resolve(testRoot, "package.json"), JSON.stringify({ ritsu_protocol_version: "7.0.0" }));
    mkdirSync(resolve(testRoot, "runtime"), { recursive: true });
    writeFileSync(resolve(testRoot, "runtime/package.json"), JSON.stringify({ ritsu_protocol_version: "7.0.0" }));

    const violations = new CrossFileDetector().detect(rule, { action: "write_artifact" });
    expect(violations).toEqual([]);
  });

  it("detects version mismatch", async () => {
    const { CrossFileDetector } = await import("../../src/policy/detectors/cross-file.js");
    writeFileSync(resolve(testRoot, "package.json"), JSON.stringify({ ritsu_protocol_version: "7.0.0" }));
    mkdirSync(resolve(testRoot, "runtime"), { recursive: true });
    writeFileSync(resolve(testRoot, "runtime/package.json"), JSON.stringify({ ritsu_protocol_version: "6.5.0" }));

    const violations = new CrossFileDetector().detect(rule, { action: "write_artifact" });
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].rule_id).toBe("AP-CROSS-FILE");
    expect(violations[0].evidence).toContain("6.5.0");
  });

  it("handles missing files gracefully", async () => {
    const { CrossFileDetector } = await import("../../src/policy/detectors/cross-file.js");
    // No package.json files at all
    const violations = new CrossFileDetector().detect(rule, { action: "write_artifact" });
    expect(violations).toEqual([]);
  });
});
