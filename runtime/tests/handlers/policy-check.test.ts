import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluatePoliciesMock } = vi.hoisted(() => ({
  evaluatePoliciesMock: vi.fn(),
}));

vi.mock("../../src/policy/index.js", () => ({
  evaluatePolicies: evaluatePoliciesMock,
}));

import { ritsu_policy_check } from "../../src/handlers/policy-check.js";

describe("ritsu_policy_check", () => {
  beforeEach(() => {
    evaluatePoliciesMock.mockReset();
  });

  it("rejects unknown actions", async () => {
    const result = await ritsu_policy_check({ action: "deploy" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("action must be write_artifact");
    expect(evaluatePoliciesMock).not.toHaveBeenCalled();
  });

  it("normalizes policy context before evaluation", async () => {
    evaluatePoliciesMock.mockReturnValue({
      passed: true,
      violations: [],
    });

    const result = await ritsu_policy_check({
      action: "write_artifact",
      target: "docs/design-sheet.md",
      content: "hello",
      context: {
        skill: "dev",
        correlation_id: "cid-123",
        in_scope_files: ["src/a.ts", 42, null],
        extra: "ignored",
      },
    });

    expect(evaluatePoliciesMock).toHaveBeenCalledWith({
      action: "write_artifact",
      target: "docs/design-sheet.md",
      content: "hello",
      context: {
        skill: "dev",
        correlation_id: "cid-123",
        in_scope_files: ["src/a.ts"],
      },
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      passed: true,
      violations: [],
    });
  });

  it("drops non-object context values and stringifies target fields", async () => {
    evaluatePoliciesMock.mockReturnValue({
      passed: true,
      violations: [],
    });

    await ritsu_policy_check({
      action: "commit_diff",
      target: 42,
      content: false,
      context: [],
    });

    expect(evaluatePoliciesMock).toHaveBeenCalledWith({
      action: "commit_diff",
      target: "42",
      content: undefined,
      context: undefined,
    });
  });
});
