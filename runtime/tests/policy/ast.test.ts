import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AstDetector } from "../../src/policy/detectors/ast.js";
import type { PolicyRule } from "../../src/policy/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("AstDetector", () => {
  const tmpFilePath = resolve(__dirname, "tmp-test-hallucination.ts");
  const relPath = "tests/policy/tmp-test-hallucination.ts";

  beforeEach(() => {
    process.env.RITSU_PROJECT_ROOT = resolve(process.cwd());
  });

  afterEach(() => {
    if (existsSync(tmpFilePath)) {
      unlinkSync(tmpFilePath);
    }
  });

  it("should detect hallucinated/unresolved identifiers (code 2304)", () => {
    writeFileSync(tmpFilePath, "const a = hallucinated_variable_xyz;\n");

    const detector = new AstDetector();
    const rule: PolicyRule = {
      id: "AP-2",
      name: "Hallucinate paths",
      severity: "fatal",
      detector: { type: "ast", target: "diff" },
    };

    const violations = detector.detect(rule, {
      action: "commit_diff",
      context: { scan_files: [relPath] },
    });

    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].rule_id).toBe("AP-2");
    expect(violations[0].message).toContain("Cannot find name");
    expect(violations[0].message).toContain("hallucinated_variable_xyz");
  });

  it("should ignore safe standard global identifiers like console and Promise", () => {
    writeFileSync(tmpFilePath, "console.log(Promise.resolve('test'));\n");

    const detector = new AstDetector();
    const rule: PolicyRule = {
      id: "AP-2",
      name: "Hallucinate paths",
      severity: "fatal",
      detector: { type: "ast", target: "diff" },
    };

    const violations = detector.detect(rule, {
      action: "commit_diff",
      context: { scan_files: [relPath] },
    });

    expect(violations.length).toBe(0);
  });
});
