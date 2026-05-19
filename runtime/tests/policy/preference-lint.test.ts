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

  it("returns no violations when the preferences file is missing", () => {
    const detector = new PreferenceLintDetector();

    expect(
      detector.detect(rule, {
        action: "write_artifact",
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
      content: "import axios from 'axios';",
    });

    expect(violations).toHaveLength(1);
    expect(violations[0].rule_id).toBe("PREF-LEGACY");
  });
});
