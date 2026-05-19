import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPolicies } from "../../src/policy/loader.js";

describe("loadPolicies", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-policy-loader-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("normalizes baseline rule severities and hoists detector exemptions", () => {
    const rules = loadPolicies();

    expect(rules.find((rule) => rule.id === "AP-1")?.severity).toBe("fatal");
    expect(rules.find((rule) => rule.id === "R-2")?.severity).toBe("hard_stop");
    expect(rules.find((rule) => rule.id === "AP-6")?.exemption).toEqual([
      {
        when: {
          skill: "init",
          target_file: "AGENTS.md",
        },
      },
    ]);
  });

  it("applies AGENTS overrides with normalized severities", () => {
    writeFileSync(
      join(testRoot, "AGENTS.md"),
      [
        "rules_overrides:",
        "  disable:",
        "    - AP-1",
        "  downgrade:",
        "    - id: R-2",
        "      severity: WARN",
        "<!-- End Ritsu Block -->",
      ].join("\n"),
      "utf-8",
    );

    const rules = loadPolicies();

    expect(rules.some((rule) => rule.id === "AP-1")).toBe(false);
    expect(rules.find((rule) => rule.id === "R-2")?.severity).toBe("warn");
  });
});
