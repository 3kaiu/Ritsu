import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";

import { reconcilePreferences } from "../../src/policy/index.js";

describe("ast-grep-reconciler", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-reconciler-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should compile preferences to AST-Grep rules and run garbage collection cleanly", () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir);

    const prefPath = join(ritsuDir, "preferences.yaml");
    const rulesDir = join(testRoot, "rules", "ast-grep");

    // Write initial preferences.yaml
    const initialPrefs = {
      rules: [
        {
          id: "avoid-moment",
          forbid_lib: "moment"
        },
        {
          id: "no-eval",
          match_regex: "\\beval\\("
        },
        {
          id: "must-init",
          require_call: "initialize()"
        }
      ]
    };
    writeFileSync(prefPath, yaml.dump(initialPrefs), "utf-8");

    // 1. Run reconciliation
    const ok = reconcilePreferences();
    expect(ok).toBe(true);

    // Verify rules were compiled
    expect(existsSync(join(rulesDir, "pref-avoid-moment.yml"))).toBe(true);
    expect(existsSync(join(rulesDir, "pref-no-eval.yml"))).toBe(true);
    expect(existsSync(join(rulesDir, "pref-must-init.yml"))).toBe(true);

    // Verify forbid_lib compilation structure
    const momentRule = yaml.load(readFileSync(join(rulesDir, "pref-avoid-moment.yml"), "utf-8")) as any;
    expect(momentRule.id).toBe("pref-avoid-moment");
    expect(momentRule.language).toBe("TypeScript");
    expect(momentRule.rule.any).toBeDefined();
    expect(momentRule.rule.any.some((p: any) => p.pattern.includes("moment"))).toBe(true);

    // Verify match_regex compilation structure
    const evalRule = yaml.load(readFileSync(join(rulesDir, "pref-no-eval.yml"), "utf-8")) as any;
    expect(evalRule.id).toBe("pref-no-eval");
    expect(evalRule.constraints.A.regex).toBe("\\beval\\(");

    // Verify require_call compilation structure
    const initRule = yaml.load(readFileSync(join(rulesDir, "pref-must-init.yml"), "utf-8")) as any;
    expect(initRule.id).toBe("pref-must-init");
    expect(initRule.rule.not.has.pattern).toBe("initialize($$$)");

    // 2. Modify preferences to trigger GC (delete 'no-eval' and 'must-init', add 'avoid-axios')
    const updatedPrefs = {
      rules: [
        {
          id: "avoid-moment",
          forbid_lib: "moment"
        },
        {
          id: "avoid-axios",
          forbid_lib: "axios"
        }
      ]
    };
    writeFileSync(prefPath, yaml.dump(updatedPrefs), "utf-8");

    // Run reconciliation again
    const ok2 = reconcilePreferences();
    expect(ok2).toBe(true);

    // Verify new rule is created
    expect(existsSync(join(rulesDir, "pref-avoid-axios.yml"))).toBe(true);
    // Verify active old rule is preserved
    expect(existsSync(join(rulesDir, "pref-avoid-moment.yml"))).toBe(true);
    // Verify deleted rules are removed by garbage collection (GC)
    expect(existsSync(join(rulesDir, "pref-no-eval.yml"))).toBe(false);
    expect(existsSync(join(rulesDir, "pref-must-init.yml"))).toBe(false);
  });

  it("should support compiling rules with custom language specified", () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir);

    const prefPath = join(ritsuDir, "preferences.yaml");
    const rulesDir = join(testRoot, "rules", "ast-grep");

    const prefs = {
      rules: [
        {
          id: "avoid-panic",
          match_regex: "panic\\(",
          language: "Go"
        }
      ]
    };
    writeFileSync(prefPath, yaml.dump(prefs), "utf-8");

    const ok = reconcilePreferences();
    expect(ok).toBe(true);

    expect(existsSync(join(rulesDir, "pref-avoid-panic.yml"))).toBe(true);
    const compiledRule = yaml.load(readFileSync(join(rulesDir, "pref-avoid-panic.yml"), "utf-8")) as any;
    expect(compiledRule.id).toBe("pref-avoid-panic");
    expect(compiledRule.language).toBe("Go");
  });
});
