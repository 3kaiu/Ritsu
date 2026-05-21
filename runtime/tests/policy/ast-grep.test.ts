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

  it("should dynamically detect target file extensions and append them to languages", () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([]));

    const detector = new AstGrepDetector();
    const rule: PolicyRule = {
      id: "AP-13",
      name: "ast-grep",
      severity: "warn",
      detector: { type: "ast_grep", rule_dir: "rules/ast-grep" },
    };

    detector.detect(rule, {
      action: "commit_diff",
      context: { scan_files: ["runtime/package.json"], skill: "dev" },
    });

    expect(execFileSync).toHaveBeenCalledTimes(2);
    const args = vi.mocked(execFileSync).mock.calls[1][1] as string[];
    const langIndex = args.indexOf("--lang");
    expect(langIndex).not.toBe(-1);
    const languagesArg = args[langIndex + 1];
    expect(languagesArg).toContain("json");
  });

  it("falls back to native parsing when ast-grep binary throws ENOENT", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory, spawn 'ast-grep'");
    });

    const detector = new AstGrepDetector();
    const rule: PolicyRule = {
      id: "AP-13",
      name: "ast-grep",
      severity: "warn",
      detector: { type: "ast_grep", rule_dir: "rules/ast-grep" },
    };

    // Create a temporary file with a debugger and a console.log statement
    const { writeFileSync, mkdtempSync, rmSync, existsSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");

    const tempDir = mkdtempSync(join(tmpdir(), "ritsu-ast-grep-fallback-"));
    const tempFile = join(tempDir, "test-fallback.ts");
    
    try {
      writeFileSync(
        tempFile,
        `
        function test() {
          console.log("hello");
          debugger;
          try {
            doSomething();
          } catch (e) {
          }
        }
        `,
        "utf-8"
      );

      const violations = detector.detect(rule, {
        action: "commit_diff",
        context: { scan_files: [tempFile], skill: "dev" },
      });

      expect(violations.length).toBeGreaterThanOrEqual(1);
      const messages = violations.map(v => v.message);
      expect(messages.some(m => m.toLowerCase().includes("console.log"))).toBe(true);
      expect(messages.some(m => m.toLowerCase().includes("debugger"))).toBe(true);
      expect(messages.some(m => m.toLowerCase().includes("empty catch"))).toBe(true);
      expect(violations[0].message).toContain("宿主系统未全局安装 ast-grep");
    } finally {
      if (existsSync(tempFile)) {
        rmSync(tempFile, { force: true });
      }
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });
});
