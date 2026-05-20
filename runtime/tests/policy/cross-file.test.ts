import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PolicyRule } from "../../src/policy/types.js";

const { checkVersionsMock } = vi.hoisted(() => ({
  checkVersionsMock: vi.fn(),
}));

vi.mock("../../version-check.js", () => ({
  checkVersions: checkVersionsMock,
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
    checkVersionsMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns no violations when the version check passes", () => {
    checkVersionsMock.mockReturnValue({
      expected: "1.0.0",
      mismatches: [],
      writes: [],
    });

    const detector = new CrossFileDetector();
    const violations = detector.detect(rule, {
      action: "write_artifact",
    });

    expect(violations).toEqual([]);
    expect(checkVersionsMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces mismatches from version check failure", () => {
    checkVersionsMock.mockReturnValue({
      expected: "1.0.0",
      mismatches: [
        { file: "AGENTS.md", found: "0.9.0", expected: "1.0.0" }
      ],
      writes: [],
    });

    const detector = new CrossFileDetector();
    const violations = detector.detect(rule, {
      action: "write_artifact",
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      rule_id: "AP-CROSS-FILE",
      severity: "error",
      evidence: "AGENTS.md: found 0.9.0, expected 1.0.0",
    });
  });

  it("falls back to the thrown error message when execution fails", () => {
    checkVersionsMock.mockImplementation(() => {
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
