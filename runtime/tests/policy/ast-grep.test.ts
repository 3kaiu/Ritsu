import { describe, expect, it, vi, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { AstGrepDetector } from "../../src/policy/detectors/ast-grep.js";
import type { PolicyRule } from "../../src/policy/types.js";

describe("AstGrepDetector", () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockReset();
    process.env.RITSU_PROJECT_ROOT = resolve(process.cwd(), "..");
  });

  it("returns violations from ast-grep json output", () => {
    vi.mocked(execFileSync).mockReturnValue(
      JSON.stringify([
        { ruleId: "ritsu-no-debugger", file: "src/a.ts", text: "debugger" },
      ]),
    );

    const detector = new AstGrepDetector();
    const rule: PolicyRule = {
      id: "AP-13",
      name: "ast-grep",
      severity: "warn",
      detector: { type: "ast_grep", rule_dir: "rules/ast-grep" },
    };

    const violations = detector.detect(rule, {
      action: "commit_diff",
      context: { scan_files: ["runtime/src/cli.ts"], skill: "dev" },
    });

    expect(violations.length).toBe(1);
    expect(violations[0].rule_id).toBe("AP-13");
  });

  it("returns empty when no scan_files", () => {
    const detector = new AstGrepDetector();
    const rule: PolicyRule = {
      id: "AP-13",
      name: "x",
      severity: "warn",
      detector: { type: "ast_grep" },
    };
    expect(
      detector.detect(rule, { action: "commit_diff", context: {} }).length,
    ).toBe(0);
  });
});
