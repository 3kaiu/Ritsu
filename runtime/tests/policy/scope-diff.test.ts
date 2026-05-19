import { describe, expect, it } from "vitest";
import { ScopeDiffDetector } from "../../src/policy/detectors/scope-diff.js";
import type { PolicyRule } from "../../src/policy/types.js";

describe("ScopeDiffDetector", () => {
  const detector = new ScopeDiffDetector();
  const rule: PolicyRule = {
    id: "AP-SCOPE",
    name: "Scope diff",
    severity: "hard_stop",
    detector: {
      type: "scope_diff",
    },
  };

  it("ignores non-commit-diff actions and missing scope data", () => {
    expect(
      detector.detect(rule, {
        action: "write_artifact",
        content: "src/app.ts",
        context: {
          in_scope_files: ["src"],
        },
      }),
    ).toEqual([]);

    expect(
      detector.detect(rule, {
        action: "commit_diff",
        content: "src/app.ts",
      }),
    ).toEqual([]);
  });

  it("accepts modified files that are directly in scope or nested under a scoped path", () => {
    const violations = detector.detect(rule, {
      action: "commit_diff",
      content: ["src/app.ts", "tests/unit/app.test.ts"].join("\n"),
      context: {
        in_scope_files: ["src", "tests/unit/app.test.ts"],
      },
    });

    expect(violations).toEqual([]);
  });

  it("flags out-of-scope files from diff content and target paths", () => {
    const fromDiff = detector.detect(rule, {
      action: "commit_diff",
      content: ["src/app.ts", "docs/README.md"].join("\n"),
      context: {
        in_scope_files: ["src"],
      },
    });
    const fromTarget = detector.detect(rule, {
      action: "commit_diff",
      target: "scripts/release.ts",
      context: {
        in_scope_files: ["src"],
      },
    });

    expect(fromDiff).toHaveLength(1);
    expect(fromDiff[0]).toMatchObject({
      rule_id: "AP-SCOPE",
      severity: "hard_stop",
      evidence: "docs/README.md",
    });
    expect(fromTarget).toHaveLength(1);
    expect(fromTarget[0].evidence).toBe("scripts/release.ts");
  });
});
