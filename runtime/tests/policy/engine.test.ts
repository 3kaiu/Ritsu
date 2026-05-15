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
});
