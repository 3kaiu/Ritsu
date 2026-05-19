import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContractCoverageDetector } from "../../src/policy/detectors/contract-coverage.js";
import type { PolicyRule } from "../../src/policy/types.js";

describe("ContractCoverageDetector", () => {
  let testRoot: string;

  const rule: PolicyRule = {
    id: "AP-TEST",
    name: "Contract Coverage",
    severity: "warn",
  };

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-contract-coverage-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("flags uncovered contracts from the docs fallback design sheet", () => {
    mkdirSync(join(testRoot, ".ritsu"), { recursive: true });
    mkdirSync(join(testRoot, "docs"), { recursive: true });

    writeFileSync(
      join(testRoot, ".ritsu", "last-quality-gate.json"),
      JSON.stringify({
        coverage: {
          per_file: {
            "tests/other.test.ts": {
              lines: { covered: 2 },
            },
          },
        },
      }),
      "utf-8",
    );
    writeFileSync(
      join(testRoot, "docs", "design-sheet.md"),
      [
        "- id: CONTRACT-1",
        "  description: verifies foo",
        "  test_file_hint: `tests/foo.test.ts`",
      ].join("\n"),
      "utf-8",
    );

    const detector = new ContractCoverageDetector();
    const violations = detector.detect(rule, {
      action: "write_artifact",
      target: "dev-report-latest.md",
    });

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("CONTRACT-1");
  });

  it("uses the latest .ritsu design sheet and accepts covered table contracts", () => {
    mkdirSync(join(testRoot, ".ritsu"), { recursive: true });
    mkdirSync(join(testRoot, "docs"), { recursive: true });

    writeFileSync(
      join(testRoot, ".ritsu", "last-quality-gate.json"),
      JSON.stringify({
        coverage: {
          per_file: {
            "tests/new-flow.test.ts": {
              lines: { covered: 3 },
            },
          },
        },
      }),
      "utf-8",
    );
    writeFileSync(
      join(testRoot, ".ritsu", "design-sheet-2026-05-01.md"),
      [
        "| ID | Description | Test File Hint |",
        "| --- | --- | --- |",
        "| CONTRACT-OLD | old contract | `tests/old-flow.test.ts` |",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(testRoot, ".ritsu", "design-sheet-2026-05-02.md"),
      [
        "| ID | Description | Test File Hint |",
        "| --- | --- | --- |",
        "| CONTRACT-NEW | latest contract | `tests/new-flow.test.ts` |",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(testRoot, "docs", "design-sheet.md"),
      [
        "- id: CONTRACT-DOCS",
        "  description: should be ignored",
        "  test_file_hint: `tests/docs-only.test.ts`",
      ].join("\n"),
      "utf-8",
    );

    const detector = new ContractCoverageDetector();
    const violations = detector.detect(rule, {
      action: "write_artifact",
      target: "assurance-sheet-latest.md",
    });

    expect(violations).toHaveLength(0);
  });
});
