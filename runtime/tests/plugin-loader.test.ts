import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

describe("plugin-loader", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-plugins-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    delete process.env.RITSU_PROJECT_ROOT;
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("getAllDetectors includes all built-in detectors", async () => {
    const { getAllDetectors } = await import("../src/policy/plugin-loader.js");
    const detectors = getAllDetectors();
    expect(detectors.regex).toBeDefined();
    expect(detectors.cross_file).toBeDefined();
    expect(detectors.scope_diff).toBeDefined();
    expect(detectors.contract_coverage).toBeDefined();
    expect(detectors.preference_lint).toBeDefined();
    expect(detectors.ast_grep).toBeDefined();
    expect(detectors.ast).toBeDefined();
    expect(detectors.codegraph).toBeDefined();
    expect(Object.keys(detectors).length).toBeGreaterThanOrEqual(8);
  });

  it("getDetector returns undefined for unknown type", async () => {
    const { getDetector } = await import("../src/policy/plugin-loader.js");
    expect(getDetector("nonexistent_type")).toBeUndefined();
  });

  it("clearPluginCache forces reload", async () => {
    const { getAllDetectors, clearPluginCache } = await import("../src/policy/plugin-loader.js");
    const before = getAllDetectors();
    clearPluginCache();
    const after = getAllDetectors();
    expect(Object.keys(before)).toEqual(Object.keys(after));
  });

  it("loads user detectors from rules/detectors/ directory", async () => {
    const detDir = resolve(testRoot, "rules", "detectors");
    mkdirSync(detDir, { recursive: true });

    writeFileSync(
      resolve(detDir, "custom-test-detector.cjs"),
      `module.exports = {
  createDetector: () => ({
    type: "custom_test_detector",
    detect: () => [{ rule_id: "CUSTOM-1", severity: "warn", message: "custom check" }],
  }),
};`,
      "utf-8",
    );

    const { getAllDetectors, clearPluginCache } = await import("../src/policy/plugin-loader.js");
    clearPluginCache(); // Force reload to pick up new file
    const detectors = getAllDetectors();
    expect(detectors.custom_test_detector).toBeDefined();
  });
});
