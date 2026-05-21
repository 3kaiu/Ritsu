import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectArtifactTypeFromFileName,
  getAllowedBinariesForProject,
  getArtifactLayer,
  getArtifactPrefixesForType,
  getCanonicalArtifactType,
  getPreferredArtifactType,
  getSharedDir,
  getStageForSkill,
  isArtifactTypeInSameFamily,
} from "../src/shared.js";

describe("shared helpers", () => {
  let previousSharedDir: string | undefined;

  beforeEach(() => {
    previousSharedDir = process.env.RITSU_SHARED_DIR;
    delete process.env.RITSU_SHARED_DIR;
  });

  afterEach(() => {
    if (previousSharedDir === undefined) {
      delete process.env.RITSU_SHARED_DIR;
    } else {
      process.env.RITSU_SHARED_DIR = previousSharedDir;
    }
  });

  it("uses the environment override for the shared directory", () => {
    process.env.RITSU_SHARED_DIR = "/tmp/custom-shared";

    expect(getSharedDir()).toBe("/tmp/custom-shared");
  });

  it("falls back to the repository shared directory", () => {
    expect(getSharedDir()).toMatch(/_shared$/);
  });

  it("maps known skills to stages and passes unknown skills through", () => {
    expect(getStageForSkill("dev")).toBe("dev");
    expect(getStageForSkill("custom-skill")).toBe("custom-skill");
  });

  it("resolves artifact prefixes, types, and layers", () => {
    expect(getArtifactPrefixesForType("all")).toContain("design-sheet-");
    expect(getArtifactPrefixesForType("diagnosis")).toEqual(["diagnosis-"]);
    expect(getCanonicalArtifactType("design-sheet")).toBe("design-sheet");
    expect(getPreferredArtifactType("design-sheet")).toBe("design-sheet");
    expect(detectArtifactTypeFromFileName("design-sheet-demo.md")).toBe("design-sheet");
    expect(detectArtifactTypeFromFileName("unknown-file.md")).toBeNull();
    expect(getArtifactLayer("diagnosis")).toBe("evidence");
    expect(getArtifactLayer("unknown")).toBe("system");
    expect(isArtifactTypeInSameFamily("design-sheet", "design-sheet")).toBe(true);
    expect(isArtifactTypeInSameFamily("design-sheet", "unknown")).toBe(false);
  });

  it("adds stack-specific binaries on top of the base allowlist", () => {
    const baseAllowed = getAllowedBinariesForProject([]);
    expect(baseAllowed.has("npm")).toBe(false);
    expect(baseAllowed.has("curl")).toBe(false);

    const allowed = getAllowedBinariesForProject(["Python", "mobile", "unknown"]);

    expect(allowed.has("git")).toBe(true);
    expect(allowed.has("python")).toBe(true);
    expect(allowed.has("pytest")).toBe(true);
    expect(allowed.has("fastlane")).toBe(true);
    expect(allowed.has("adb")).toBe(true);
    expect(allowed.has("curl")).toBe(true);

    const nodeAllowed = getAllowedBinariesForProject(["nodejs"]);
    expect(nodeAllowed.has("npm")).toBe(true);
    expect(nodeAllowed.has("curl")).toBe(true);
  });

  it("enforces minimal secure subset when fingerprints are missing/invalid", () => {
    // Missing, empty, or undefined fingerprints must default strictly to minimal secure binaries
    const emptyAllowed = getAllowedBinariesForProject([]);
    expect(emptyAllowed.has("node")).toBe(false);
    expect(emptyAllowed.has("npx")).toBe(false);
    expect(emptyAllowed.has("tsc")).toBe(false);
    expect(emptyAllowed.has("mkdir")).toBe(false);
    expect(emptyAllowed.has("git")).toBe(true);
    expect(emptyAllowed.has("grep")).toBe(true);

    const nullAllowed = getAllowedBinariesForProject(undefined);
    expect(nullAllowed.has("node")).toBe(false);
    expect(nullAllowed.has("git")).toBe(true);

    const invalidAllowed = getAllowedBinariesForProject(["", "  "]);
    expect(invalidAllowed.has("node")).toBe(false);
    expect(invalidAllowed.has("git")).toBe(true);

    // Python-only stack should NOT have node execution capabilities
    const pyAllowed = getAllowedBinariesForProject(["python"]);
    expect(pyAllowed.has("node")).toBe(false);
    expect(pyAllowed.has("git")).toBe(true);
    expect(pyAllowed.has("python")).toBe(true);

    // nodejs stack elements must successfully elevate node/ts privileges
    const tsAllowed = getAllowedBinariesForProject(["typescript"]);
    expect(tsAllowed.has("node")).toBe(true);
    expect(tsAllowed.has("npx")).toBe(true);
    expect(tsAllowed.has("tsc")).toBe(true);
    expect(tsAllowed.has("mkdir")).toBe(true);
    expect(tsAllowed.has("git")).toBe(true);
  });
});
