import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PreferenceLintDetector } from "../../src/policy/detectors/preference-lint.js";
import type { PolicyRule } from "../../src/policy/types.js";

describe("PreferenceLintDetector", () => {
  let testRoot: string;
  let originalProjectRoot: string | undefined;

  const rule: PolicyRule = {
    id: "AP-PREFERENCE",
    name: "Preference lint",
    severity: "warn",
    detector: {
      type: "preference_lint",
    },
  };

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-preference-lint-"));
    originalProjectRoot = process.env.RITSU_PROJECT_ROOT;
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    if (originalProjectRoot === undefined) {
      delete process.env.RITSU_PROJECT_ROOT;
    } else {
      process.env.RITSU_PROJECT_ROOT = originalProjectRoot;
    }
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("reports regex, forbidden library, and missing required call preferences", () => {
    mkdirSync(join(testRoot, ".ritsu"), { recursive: true });
    writeFileSync(
      join(testRoot, ".ritsu", "preferences.yaml"),
      [
        "rules:",
        "  - id: PREF-REGEX",
        "    match_regex: TODO",
        "  - id: PREF-LIB",
        "    forbid_lib: axios",
        "  - id: PREF-CALL",
        "    require_call: safeCall()",
        "  - id: PREF-INVALID",
        "    forbid_lib: 123",
      ].join("\n"),
      "utf-8",
    );

    const detector = new PreferenceLintDetector();
    const violations = detector.detect(rule, {
      action: "write_artifact",
      target: "test.ts",
      content: [
        "// TODO: tighten this",
        "import axios from 'axios';",
        "console.log('hello');",
      ].join("\n"),
    });

    expect(violations).toHaveLength(3);
    expect(violations.map((violation) => violation.rule_id)).toEqual([
      "PREF-REGEX",
      "PREF-LIB",
      "PREF-CALL",
    ]);
    expect(violations.every((violation) => violation.severity === "warn")).toBe(
      true,
    );
  });

  it("filters require_call and forbid_lib for non-source markdown files", () => {
    mkdirSync(join(testRoot, ".ritsu"), { recursive: true });
    writeFileSync(
      join(testRoot, ".ritsu", "preferences.yaml"),
      [
        "rules:",
        "  - id: PREF-REGEX",
        "    match_regex: TODO",
        "  - id: PREF-LIB",
        "    forbid_lib: axios",
        "  - id: PREF-CALL",
        "    require_call: safeCall()",
      ].join("\n"),
      "utf-8",
    );

    const detector = new PreferenceLintDetector();
    
    // 1. Text outside code blocks with axios/safeCall should skip forbid_lib/require_call, but still detect match_regex
    const violationsProse = detector.detect(rule, {
      action: "write_artifact",
      target: "report.md",
      content: [
        "We have a TODO item here.",
        "Prose discussing safeCall() or importing axios is fine.",
      ].join("\n"),
    });
    expect(violationsProse).toHaveLength(1);
    expect(violationsProse[0].rule_id).toBe("PREF-REGEX");

    // 2. Text with forbidden lib inside code block should be detected
    const violationsCodeBlock = detector.detect(rule, {
      action: "write_artifact",
      target: "report.md",
      content: [
        "```ts",
        "import axios from 'axios';",
        "```"
      ].join("\n"),
    });
    expect(violationsCodeBlock).toHaveLength(1);
    expect(violationsCodeBlock[0].rule_id).toBe("PREF-LIB");
  });

  it("returns no violations when the preferences file is missing", () => {
    const detector = new PreferenceLintDetector();

    expect(
      detector.detect(rule, {
        action: "write_artifact",
        target: "test.ts",
        content: "console.log('hello');",
      }),
    ).toEqual([]);
  });

  it("ignores malformed preference files", () => {
    mkdirSync(join(testRoot, ".ritsu"), { recursive: true });
    writeFileSync(
      join(testRoot, ".ritsu", "preferences.yaml"),
      "rules: [unterminated",
      "utf-8",
    );

    const detector = new PreferenceLintDetector();

    expect(
      detector.detect(rule, {
        action: "write_artifact",
        target: "test.ts",
        content: "import axios from 'axios';",
      }),
    ).toEqual([]);
  });

  it("supports legacy preferences roots", () => {
    mkdirSync(join(testRoot, ".ritsu"), { recursive: true });
    writeFileSync(
      join(testRoot, ".ritsu", "preferences.yaml"),
      [
        "preferences:",
        "  - id: PREF-LEGACY",
        "    forbid_lib: axios",
      ].join("\n"),
      "utf-8",
    );

    const detector = new PreferenceLintDetector();
    const violations = detector.detect(rule, {
      action: "write_artifact",
      target: "test.ts",
      content: "import axios from 'axios';",
    });

    expect(violations).toHaveLength(1);
    expect(violations[0].rule_id).toBe("PREF-LEGACY");
  });

  it("verifies AST-based precision for forbid_lib and require_call in JS/TS files", () => {
    mkdirSync(join(testRoot, ".ritsu"), { recursive: true });
    writeFileSync(
      join(testRoot, ".ritsu", "preferences.yaml"),
      [
        "rules:",
        "  - id: PREF-LIB",
        "    forbid_lib: axios",
        "  - id: PREF-CALL",
        "    require_call: safeCall()",
      ].join("\n"),
      "utf-8",
    );

    const detector = new PreferenceLintDetector();

    // 1. Forbidden lib imported via require() and dynamic import() should trigger forbid_lib
    const violationsCjs = detector.detect(rule, {
      action: "write_artifact",
      target: "test.ts",
      content: [
        "const axios = require('axios');",
        "safeCall(123);",
      ].join("\n"),
    });
    expect(violationsCjs.map(v => v.rule_id)).toContain("PREF-LIB");
    expect(violationsCjs.map(v => v.rule_id)).not.toContain("PREF-CALL"); // safeCall(123) called correctly

    // 2. Spaces and arguments in require_call should match perfectly via AST
    const violationsSpaces = detector.detect(rule, {
      action: "write_artifact",
      target: "test.ts",
      content: [
        "import 'lodash';",
        "safeCall  ( 'hello', { key: 'val' } );",
      ].join("\n"),
    });
    expect(violationsSpaces.map(v => v.rule_id)).not.toContain("PREF-CALL"); // safeCall matches despite spaces & arguments

    // 3. Comments containing require_call name should NOT trigger as a valid call
    const violationsComment = detector.detect(rule, {
      action: "write_artifact",
      target: "test.ts",
      content: [
        "// safeCall();",
        "/* safeCall() */",
      ].join("\n"),
    });
    expect(violationsComment.map(v => v.rule_id)).toContain("PREF-CALL"); // should trigger warning because there is no actual CallExpression in AST
  });
});

