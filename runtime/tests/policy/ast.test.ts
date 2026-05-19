import { describe, expect, it } from "vitest";
import { ASTDetector } from "../../src/policy/detectors/ast.js";
import type { PolicyRule } from "../../src/policy/types.js";

describe("ASTDetector", () => {
  const detector = new ASTDetector();

  it("detects unused variables while ignoring underscored names", () => {
    const rule: PolicyRule = {
      id: "AP-AST-UNUSED",
      name: "AST unused variables",
      severity: "warn",
      detector: {
        type: "ast",
        check_unused: true,
      },
    };

    const violations = detector.detect(rule, {
      action: "write_artifact",
      target: "src/example.ts",
      content: [
        "const unused = 1;",
        "const _intentional = 2;",
        "const used = 3;",
        "console.log(used);",
      ].join("\n"),
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      rule_id: "AP-AST-UNUSED",
      severity: "warn",
      evidence: "unused",
    });
  });

  it("detects forbidden identifiers", () => {
    const rule: PolicyRule = {
      id: "AP-AST-ID",
      name: "AST forbidden identifiers",
      severity: "fatal",
      detector: {
        type: "ast",
        check_identifiers: true,
        forbidden_identifiers: ["TODO", "FIXME"],
      },
    };

    const violations = detector.detect(rule, {
      action: "write_artifact",
      target: "src/example.ts",
      content: "const TODO = 1;\nconsole.log(TODO);",
    });

    expect(violations).toHaveLength(2);
    expect(violations.every((violation) => violation.rule_id === "AP-AST-ID")).toBe(
      true,
    );
    expect(violations.every((violation) => violation.evidence === "TODO")).toBe(
      true,
    );
  });

  it("detects unknown identifiers and misspellings", () => {
    const rule: PolicyRule = {
      id: "AP-AST-UNKNOWN",
      name: "AST unknown identifiers",
      severity: "fatal",
      detector: {
        type: "ast",
        check_identifiers: true,
      },
    };

    const violations = detector.detect(rule, {
      action: "write_artifact",
      target: "src/example.ts",
      content: [
        "const value = missingVar + 1;",
        "consle.log(value);",
      ].join("\n"),
    });

    expect(violations).toHaveLength(2);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: "AP-AST-UNKNOWN",
          severity: "fatal",
          evidence: "missingVar",
        }),
        expect.objectContaining({
          rule_id: "AP-AST-UNKNOWN",
          severity: "fatal",
          evidence: "consle",
        }),
      ]),
    );
  });

  it("detects unresolved JSX components while ignoring common ambient globals", () => {
    const rule: PolicyRule = {
      id: "R-1",
      name: "Unknown identifiers in JSX",
      severity: "hard_stop",
      detector: {
        type: "ast",
        check_identifiers: true,
      },
    };

    const jsxViolations = detector.detect(rule, {
      action: "write_artifact",
      target: "src/App.tsx",
      content: "export function App() { return <MissingWidget />; }",
    });
    const nodeViolations = detector.detect(rule, {
      action: "write_artifact",
      target: "src/env.ts",
      content: "export const mode = process.env.NODE_ENV ?? 'development';",
    });
    const testViolations = detector.detect(rule, {
      action: "write_artifact",
      target: "tests/example.test.ts",
      content: "describe('suite', () => { it('works', () => expect(1).toBe(1)); });",
    });

    expect(jsxViolations).toHaveLength(1);
    expect(jsxViolations[0]).toMatchObject({
      rule_id: "R-1",
      severity: "hard_stop",
      evidence: "MissingWidget",
    });
    expect(nodeViolations).toEqual([]);
    expect(testViolations).toEqual([]);
  });

  it("skips non-code targets and malformed source", () => {
    const rule: PolicyRule = {
      id: "AP-AST-SKIP",
      name: "AST skip unsupported inputs",
      severity: "warn",
      detector: {
        type: "ast",
        check_unused: true,
        check_identifiers: true,
        forbidden_identifiers: ["TODO"],
      },
    };

    expect(
      detector.detect(rule, {
        action: "write_artifact",
        target: "docs/design-sheet.md",
        content: "const unused = 1;",
      }),
    ).toEqual([]);

    expect(
      detector.detect(rule, {
        action: "write_artifact",
        target: "src/broken.ts",
        content: "const =",
      }),
    ).toEqual([]);
  });
});
