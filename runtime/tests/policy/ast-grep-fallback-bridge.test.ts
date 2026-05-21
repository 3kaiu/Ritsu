import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { AstGrepRuleBridge } from "../../src/policy/detectors/ast-grep.js";

describe("AstGrepRuleBridge", () => {
  it("compiles patterns into regular expressions correctly", () => {
    const regex1 = AstGrepRuleBridge.patternToRegex("debugger");
    expect(regex1.test("debugger;")).toBe(true);

    const regex2 = AstGrepRuleBridge.patternToRegex("console.log($$$)");
    expect(regex2.test("console.log('test')")).toBe(true);
    regex2.lastIndex = 0;
    expect(regex2.test("console.log()")).toBe(true);

    const regex3 = AstGrepRuleBridge.patternToRegex("eval($ARG)");
    expect(regex3.test("eval(code)")).toBe(true);
  });

  it("creates AST matchers for standard patterns", () => {
    const sourceFile = ts.createSourceFile(
      "test.ts",
      `
      debugger;
      console.log('hi');
      eval('bad');
      try {} catch (err) {}
      `,
      ts.ScriptTarget.Latest,
      true
    );

    const debuggerMatcher = AstGrepRuleBridge.createAstMatcher("debugger");
    const consoleMatcher = AstGrepRuleBridge.createAstMatcher("console.log($$$)");
    const evalMatcher = AstGrepRuleBridge.createAstMatcher("eval($$$)");
    const catchMatcher = AstGrepRuleBridge.createAstMatcher("catch ($E) {}");

    let foundDebugger = false;
    let foundConsole = false;
    let foundEval = false;
    let foundCatch = false;

    const visit = (node: ts.Node) => {
      if (debuggerMatcher(node)) foundDebugger = true;
      if (consoleMatcher(node)) foundConsole = true;
      if (evalMatcher(node)) foundEval = true;
      if (catchMatcher(node)) foundCatch = true;
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    expect(foundDebugger).toBe(true);
    expect(foundConsole).toBe(true);
    expect(foundEval).toBe(true);
    expect(foundCatch).toBe(true);
  });

  it("loads rules from yml rule directory", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ritsu-rules-test-"));
    const ruleFile = join(tempDir, "no-eval.yml");

    try {
      writeFileSync(
        ruleFile,
        `
id: no-eval
message: Do not use eval
severity: error
language: TypeScript
rule:
  pattern: eval($$$)
        `,
        "utf-8"
      );

      const rules = AstGrepRuleBridge.loadRules(tempDir);
      expect(rules.length).toBe(1);
      expect(rules[0].id).toBe("no-eval");
      expect(rules[0].pattern).toBe("eval($$$)");
      expect(rules[0].message).toBe("Do not use eval");
      expect(rules[0].severity).toBe("error");
    } finally {
      if (existsSync(ruleFile)) rmSync(ruleFile, { force: true });
      if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
