import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { detectProjectRoot } from "../src/project-root.js";

describe("detectProjectRoot", () => {
  let testRoot: string;
  let previousProjectRoot: string | undefined;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-project-root-"));
    previousProjectRoot = process.env.RITSU_PROJECT_ROOT;
    delete process.env.RITSU_PROJECT_ROOT;
  });

  afterEach(() => {
    if (previousProjectRoot === undefined) {
      delete process.env.RITSU_PROJECT_ROOT;
    } else {
      process.env.RITSU_PROJECT_ROOT = previousProjectRoot;
    }
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("prefers RITSU_PROJECT_ROOT when set", () => {
    const envRoot = resolve(testRoot, "env-root");
    const nested = resolve(testRoot, "nested", "child");
    mkdirSync(envRoot, { recursive: true });
    mkdirSync(nested, { recursive: true });
    process.env.RITSU_PROJECT_ROOT = envRoot;

    expect(detectProjectRoot(nested)).toBe(envRoot);
  });

  it("walks upward to the nearest AGENTS.md", () => {
    const projectRoot = resolve(testRoot, "project");
    const nested = resolve(projectRoot, "packages", "runtime");
    mkdirSync(nested, { recursive: true });
    writeFileSync(resolve(projectRoot, "AGENTS.md"), "# project", "utf-8");

    expect(detectProjectRoot(nested)).toBe(projectRoot);
  });

  it("falls back to the nearest .ritsu directory when AGENTS.md is absent", () => {
    const projectRoot = resolve(testRoot, "project");
    const nested = resolve(projectRoot, "packages", "runtime");
    mkdirSync(resolve(projectRoot, ".ritsu"), { recursive: true });
    mkdirSync(nested, { recursive: true });

    expect(detectProjectRoot(nested)).toBe(projectRoot);
  });

  it("returns the start directory when no project markers exist", () => {
    const nested = resolve(testRoot, "standalone", "runtime");
    mkdirSync(nested, { recursive: true });

    expect(detectProjectRoot(nested)).toBe(nested);
  });
});
