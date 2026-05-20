import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluatePolicies } from "../../src/policy/index.js";
import { loadPolicies } from "../../src/policy/loader.js";
import { RegexDetector } from "../../src/policy/detectors/regex.js";

vi.mock("../../src/policy/loader.js", () => ({
  loadPolicies: vi.fn()
}));

describe("Policy Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should pass if no rules are loaded", () => {
    (loadPolicies as any).mockReturnValue([]);
    const result = evaluatePolicies({ action: "write_artifact", content: "hello" });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("should fail if regex detector matches", () => {
    (loadPolicies as any).mockReturnValue([
      {
        id: "AP-TEST",
        name: "Test Rule",
        severity: "fatal",
        detector: {
          type: "regex",
          target: "artifact_content",
          patterns: ["TODO"]
        }
      }
    ]);

    const result = evaluatePolicies({ 
      action: "write_artifact", 
      content: "this is a TODO item" 
    });
    
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].rule_id).toBe("AP-TEST");
  });

  it("should handle exemptions", () => {
    (loadPolicies as any).mockReturnValue([
      {
        id: "AP-TEST",
        name: "Test Rule",
        severity: "fatal",
        detector: {
          type: "regex",
          target: "artifact_content",
          patterns: ["TODO"]
        },
        exemption: [
            { when: { skill: "init" } }
        ]
      }
    ]);

    const result = evaluatePolicies({ 
      action: "write_artifact", 
      content: "this is a TODO item",
      context: { skill: "init" }
    });
    
    expect(result.passed).toBe(true);
  });

  it("should skip detectors whose target does not match the action", () => {
    (loadPolicies as any).mockReturnValue([
      {
        id: "AP-ARTIFACT",
        name: "Artifact Only",
        severity: "fatal",
        detector: {
          type: "regex",
          target: "artifact_content",
          patterns: ["TODO"],
        },
      },
      {
        id: "AP-DIFF",
        name: "Diff Only",
        severity: "fatal",
        detector: {
          type: "regex",
          target: "diff",
          patterns: ["TODO"],
        },
      },
    ]);

    const diffResult = evaluatePolicies({
      action: "commit_diff",
      content: "TODO in artifact text",
    });
    const artifactResult = evaluatePolicies({
      action: "write_artifact",
      content: "TODO in artifact text",
    });

    expect(diffResult.violations.map((violation) => violation.rule_id)).toEqual(["AP-DIFF"]);
    expect(artifactResult.violations.map((violation) => violation.rule_id)).toEqual([
      "AP-ARTIFACT",
    ]);
  });

  it("should honor target_file exemptions using path suffix matching", () => {
    (loadPolicies as any).mockReturnValue([
      {
        id: "AP-TEST",
        name: "Test Rule",
        severity: "fatal",
        detector: {
          type: "regex",
          target: "artifact_content",
          patterns: ["TODO"],
        },
        exemption: [{ when: { target_file: "AGENTS.md" } }],
      },
    ]);

    const result = evaluatePolicies({
      action: "write_artifact",
      target: "docs/AGENTS.md",
      content: "TODO item",
    });

    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("should throw when a detector type is not registered", () => {
    (loadPolicies as any).mockReturnValue([
      {
        id: "AP-UNKNOWN",
        name: "Unknown Detector",
        severity: "fatal",
        detector: {
          type: "missing",
          target: "artifact_content",
        },
      },
    ]);

    expect(() =>
      evaluatePolicies({
        action: "write_artifact",
        content: "hello",
      }),
    ).toThrow("Detector type 'missing' is not registered");
  });
});
