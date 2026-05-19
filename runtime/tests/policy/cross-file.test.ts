import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PolicyRule } from "../../src/policy/types.js";

const { execSyncMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: execSyncMock,
}));

import { CrossFileDetector } from "../../src/policy/detectors/cross-file.js";

describe("CrossFileDetector", () => {
  const rule: PolicyRule = {
    id: "AP-CROSS-FILE",
    name: "Cross-file version drift",
    severity: "error",
    detector: {
      type: "cross_file",
    },
  };

  beforeEach(() => {
    execSyncMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns no violations when the version check passes", () => {
    execSyncMock.mockReturnValue("");

    const detector = new CrossFileDetector();
    const violations = detector.detect(rule, {
      action: "write_artifact",
    });

    expect(violations).toEqual([]);
    expect(execSyncMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces stderr text from the version check failure", () => {
    execSyncMock.mockImplementation(() => {
      throw Object.assign(new Error("failed"), {
        stderr: "AGENTS.md mismatch",
      });
    });

    const detector = new CrossFileDetector();
    const violations = detector.detect(rule, {
      action: "write_artifact",
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      rule_id: "AP-CROSS-FILE",
      severity: "error",
      evidence: "AGENTS.md mismatch",
    });
  });

  it("decodes stderr buffers from the version check failure", () => {
    execSyncMock.mockImplementation(() => {
      throw Object.assign(new Error("failed"), {
        stderr: Buffer.from("package.json mismatch"),
      });
    });

    const detector = new CrossFileDetector();
    const violations = detector.detect(rule, {
      action: "write_artifact",
    });

    expect(violations).toHaveLength(1);
    expect(violations[0].evidence).toBe("package.json mismatch");
  });

  it("falls back to the thrown error message when stderr is unavailable", () => {
    execSyncMock.mockImplementation(() => {
      throw new Error("generic failure");
    });

    const detector = new CrossFileDetector();
    const violations = detector.detect(rule, {
      action: "write_artifact",
    });

    expect(violations).toHaveLength(1);
    expect(violations[0].evidence).toBe("generic failure");
  });
});
