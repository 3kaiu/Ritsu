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
    const allowed = getAllowedBinariesForProject(["Python", "mobile", "unknown"]);

    expect(allowed.has("git")).toBe(true);
    expect(allowed.has("python")).toBe(true);
    expect(allowed.has("pytest")).toBe(true);
    expect(allowed.has("fastlane")).toBe(true);
    expect(allowed.has("adb")).toBe(true);
  });
});
