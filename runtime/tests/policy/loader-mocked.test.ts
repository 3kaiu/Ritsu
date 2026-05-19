import { beforeEach, describe, expect, it, vi } from "vitest";

const { existsSyncMock, readFileSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
}));

import { loadPolicies } from "../../src/policy/loader.js";

describe("loadPolicies mocked inputs", () => {
  beforeEach(() => {
    process.env.RITSU_PROJECT_ROOT = "/tmp/ritsu-loader-mocked";
    vi.clearAllMocks();

    existsSyncMock.mockImplementation((path: unknown) => {
      return typeof path === "string" && path.endsWith("anti-patterns.yaml");
    });
    readFileSyncMock.mockImplementation((path: unknown) => {
      if (typeof path === "string" && path.endsWith("anti-patterns.yaml")) {
        return [
          "global:",
          "  - id: VALID",
          "    name: Valid Rule",
          "    severity: fatal",
          "    detector:",
          "      type: regex",
          "      target: artifact_content",
          "      patterns: [TODO]",
          "  - id: INVALID-SEVERITY",
          "    name: Invalid Severity Rule",
          "    severity: nope",
          "    detector:",
          "      type: regex",
          "      target: artifact_content",
          "      patterns: [TODO]",
          "  - id: MISSING-NAME",
          "    severity: warn",
          "    detector:",
          "      type: regex",
          "      target: artifact_content",
          "      patterns: [TODO]",
          "review: {}",
        ].join("\n");
      }
      throw new Error(`unexpected path: ${String(path)}`);
    });
  });

  it("drops invalid baseline rules and invalid severities", () => {
    const rules = loadPolicies();

    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      id: "VALID",
      name: "Valid Rule",
      severity: "fatal",
    });
  });
});
