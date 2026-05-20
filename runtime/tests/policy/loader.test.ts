import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync, utimesSync, mkdirSync } from "node:fs";
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

  it("caches loaded policies and invalidates cache when AGENTS.md changes", () => {
    const agentsPath = join(testRoot, "AGENTS.md");
    writeFileSync(
      agentsPath,
      [
        "rules_overrides:",
        "  disable:",
        "    - AP-1",
        "<!-- End Ritsu Block -->",
      ].join("\n"),
      "utf-8",
    );

    const rules1 = loadPolicies();
    expect(rules1.some((rule) => rule.id === "AP-1")).toBe(false);

    // 1. Mutate rules1, verify subsequent load is unaffected (prevents cache corruption)
    rules1[0].id = "MUTATED-ID";
    const rules2 = loadPolicies();
    expect(rules2[0].id).not.toBe("MUTATED-ID");
    expect(rules2.some((rule) => rule.id === "AP-1")).toBe(false);

    // 2. Modify AGENTS.md and change mtimeMs to invalidate cache
    writeFileSync(
      agentsPath,
      [
        "rules_overrides:",
        "  disable:",
        "    - AP-2",
        "<!-- End Ritsu Block -->",
      ].join("\n"),
      "utf-8",
    );
    // Explicitly update mtimeMs forward to guarantee cache invalidation
    const future = new Date(Date.now() + 5000);
    utimesSync(agentsPath, future, future);

    const rules3 = loadPolicies();
    // Now AP-1 should be present because disable list changed to AP-2
    expect(rules3.some((rule) => rule.id === "AP-1")).toBe(true);
    expect(rules3.some((rule) => rule.id === "AP-2")).toBe(false);
  });

  it("automatically reconciles preferences.yaml changes to AST-Grep rules", () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir, { recursive: true });
    const prefPath = join(ritsuDir, "preferences.yaml");

    // Write a mock preference
    writeFileSync(
      prefPath,
      [
        "rules:",
        "  - id: custom-lib",
        "    forbid_lib: forbidden-package",
      ].join("\n"),
      "utf-8",
    );

    // Call loadPolicies, which should trigger reconciliation under the hood!
    loadPolicies();

    // Verify AST-Grep rule was compiled
    const compiledRulePath = join(testRoot, "rules/ast-grep/pref-custom-lib.yml");
    expect(existsSync(compiledRulePath)).toBe(true);

    // Update preference to use different packages and change mtime to trigger reload
    writeFileSync(
      prefPath,
      [
        "rules:",
        "  - id: custom-lib-updated",
        "    forbid_lib: different-package",
      ].join("\n"),
      "utf-8",
    );
    const future = new Date(Date.now() + 5000);
    utimesSync(prefPath, future, future);

    loadPolicies();

    // Verify old rule was cleaned up and new rule compiled
    expect(existsSync(compiledRulePath)).toBe(false);
    expect(existsSync(join(testRoot, "rules/ast-grep/pref-custom-lib-updated.yml"))).toBe(true);
  });
});
