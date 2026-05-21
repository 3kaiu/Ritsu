import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { autoApplyMinedRules, synthesizeRulesFromCorrections } from "../src/miner.js";
import { existsSync, rmSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import yaml from "js-yaml";

function formatRitsuTs(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

describe("Ritsu Adaptive Learning Engine", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-miner-adaptive-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;

    // Initialize git repo
    execSync("git init", { cwd: testRoot, stdio: "ignore" });
    writeFileSync(join(testRoot, "README.md"), "# Ritsu Test");
    execSync("git add README.md", { cwd: testRoot, stdio: "ignore" });
    execSync("git config user.email 'adaptive@ritsu.com'", { cwd: testRoot, stdio: "ignore" });
    execSync("git config user.name 'Adaptive Test'", { cwd: testRoot, stdio: "ignore" });
    execSync("git commit -m 'init'", { cwd: testRoot, stdio: "ignore" });
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should synthesize pref-auto-logger when console is replaced by logger", () => {
    const corrections = [
      {
        file: "index.ts",
        diff: `
diff --git a/index.ts b/index.ts
--- a/index.ts
+++ b/index.ts
@@ -1,3 +1,3 @@
-console.log('running server');
+logger.info('running server');
`
      }
    ];

    const rules = synthesizeRulesFromCorrections(corrections);
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("pref-auto-logger");
    expect(rules[0].match_regex).toBe("console\\.(log|warn|error|info)");
    expect(rules[0].scope).toBe("coding_style");
  });

  it("should synthesize pref-auto-const when let is replaced by const for the same variable", () => {
    const corrections = [
      {
        file: "index.ts",
        diff: `
diff --git a/index.ts b/index.ts
--- a/index.ts
+++ b/index.ts
@@ -1,3 +1,3 @@
-let count = 10;
+const count = 10;
`
      }
    ];

    const rules = synthesizeRulesFromCorrections(corrections);
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("pref-auto-const");
    expect(rules[0].match_regex).toBe("\\blet\\s+([a-zA-Z_]\\w*)\\b");
  });

  it("should synthesize pref-auto-no-any when ': any' is replaced by a concrete type", () => {
    const corrections = [
      {
        file: "index.ts",
        diff: `
diff --git a/index.ts b/index.ts
--- a/index.ts
+++ b/index.ts
@@ -1,3 +1,3 @@
-function handle(payload: any) {}
+function handle(payload: string) {}
`
      }
    ];

    const rules = synthesizeRulesFromCorrections(corrections);
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("pref-auto-no-any");
    expect(rules[0].match_regex).toBe(":\\s*any\\b");
  });

  it("should synthesize pref-auto-lodash-es when import is optimized from lodash to lodash-es", () => {
    const corrections = [
      {
        file: "index.ts",
        diff: `
diff --git a/index.ts b/index.ts
--- a/index.ts
+++ b/index.ts
@@ -1,3 +1,3 @@
-import { cloneDeep } from 'lodash';
+import { cloneDeep } from 'lodash-es';
`
      }
    ];

    const rules = synthesizeRulesFromCorrections(corrections);
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("pref-auto-lodash-es");
  });

  it("should synthesize generic mined rule for exact repeating deleted line", () => {
    const corrections = [
      {
        file: "src/app.ts",
        diff: `
diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,3 @@
-legacyApiCall();
+newApiCall();
`
      },
      {
        file: "src/utils.ts",
        diff: `
diff --git a/src/utils.ts b/src/utils.ts
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,3 +1,3 @@
-legacyApiCall();
+newApiCall();
`
      }
    ];

    const rules = synthesizeRulesFromCorrections(corrections);
    const minedRule = rules.find((r) => r.id.startsWith("pref-auto-mined-"));
    expect(minedRule).toBeDefined();
    expect(minedRule!.match_regex).toBe("legacyApiCall\\(\\);");
  });

  it("should merge mined rules conflict-free and trigger automatic preferences.yaml compilation", async () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir);

    // AI write index.ts
    const codeFile = join(testRoot, "index.ts");
    writeFileSync(codeFile, "console.log('AI write');\n");
    execSync("git add index.ts", { cwd: testRoot, stdio: "ignore" });
    execSync("git commit -m 'AI commit'", { cwd: testRoot, stdio: "ignore" });

    // Mock Write Event
    const ts = formatRitsuTs(new Date(Date.now() - 1000 * 60));
    const ctxFile = join(ritsuDir, "ctx-20260521.jsonl");
    writeFileSync(
      ctxFile,
      JSON.stringify({ ts, status: "artifact_written", artifact: "index.ts" }) + "\n",
      "utf-8"
    );

    // Human overrides
    writeFileSync(codeFile, "logger.info('AI write');\n");
    execSync("git add index.ts", { cwd: testRoot, stdio: "ignore" });
    execSync("git commit -m 'human override'", { cwd: testRoot, stdio: "ignore" });

    // Create existing preferences.yaml
    const prefFile = join(ritsuDir, "preferences.yaml");
    writeFileSync(
      prefFile,
      yaml.dump({
        rules: [
          {
            id: "pref-existing",
            match_regex: "some-regex",
            scope: "coding_style"
          }
        ]
      }),
      "utf-8"
    );

    // Execute auto Apply
    const result = await autoApplyMinedRules(7);
    expect(result.addedCount).toBe(1);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].id).toBe("pref-auto-logger");

    // Assert file was updated correctly
    const prefContent = readFileSync(prefFile, "utf-8");
    expect(prefContent).toContain("id: pref-existing");
    expect(prefContent).toContain("id: pref-auto-logger");

    // Assert compiled rules exist and reconcile succeeded
    expect(existsSync(join(testRoot, "rules/ast-grep/pref-pref-auto-logger.yml"))).toBe(true);
  });
});
