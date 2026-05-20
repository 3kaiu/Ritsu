import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectStackFingerprints,
  parseCommand,
  runCmdWithCwd,
  validateCommandSafety,
} from "../src/handlers/_cmd-utils.js";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("_cmd-utils", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-cmd-utils-"));
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("parses commands with quoted arguments", () => {
    expect(parseCommand(`git commit -m "hello world"`)).toEqual({
      binary: "git",
      args: ["commit", "-m", "hello world"],
    });
    expect(parseCommand(`node -e 'console.log("x")'`)).toEqual({
      binary: "node",
      args: ["-e", 'console.log("x")'],
    });
    expect(parseCommand("   ")).toBeNull();
  });

  it("validates command safety for meta characters, blocked binaries, dangerous args, and safe commands", () => {
    expect(validateCommandSafety("echo hi | cat")).toMatchObject({
      ok: false,
    });
    expect(validateCommandSafety("   ")).toEqual({
      ok: false,
      error: "empty command after parsing",
    });
    expect(validateCommandSafety("python script.py")).toMatchObject({
      ok: false,
    });
    expect(validateCommandSafety(`node -e "console.log('x')"`)).toMatchObject({
      ok: false,
    });
    expect(validateCommandSafety("git reset --hard")).toMatchObject({
      ok: false,
    });
    expect(validateCommandSafety("git status")).toEqual({ ok: true });
  });

  it("runs commands successfully and truncates long output", async () => {
    const result = await runCmdWithCwd(
      {
        binary: "node",
        args: [
          "-e",
          "for (let i = 0; i < 5; i++) console.log(`line-${i}`)",
        ],
      },
      testRoot,
      2,
      10_000,
      1,
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("line-0");
    expect(result.output).toContain("line-1");
    expect(result.output).toContain("输出已截断");
  });

  it("returns stderr for failed commands", async () => {
    const result = await runCmdWithCwd(
      {
        binary: "node",
        args: [
          "-e",
          "console.error('boom'); process.exit(2);",
        ],
      },
      testRoot,
    );

    expect(result).toEqual({
      ok: false,
      output: "boom",
    });
  });

  it("returns timeout when the process exceeds the deadline", async () => {
    const result = await runCmdWithCwd(
      {
        binary: "node",
        args: [
          "-e",
          "setTimeout(() => console.log('late'), 200);",
        ],
      },
      testRoot,
      200,
      20,
    );

    expect(result.ok).toBe(false);
    expect(result.output).toBe("timeout");
  });

  it("returns spawn errors for missing binaries", async () => {
    const result = await runCmdWithCwd(
      {
        binary: "ritsu-this-does-not-exist",
        args: [],
      },
      testRoot,
    );

    expect(result.ok).toBe(false);
    expect(result.output).toContain("ENOENT");
  });

  it("detects stack fingerprints from project files", () => {
    writeFileSync(join(testRoot, "package.json"), "{}", "utf-8");
    writeFileSync(join(testRoot, "go.mod"), "module demo", "utf-8");
    writeFileSync(join(testRoot, "pyproject.toml"), "[project]", "utf-8");
    writeFileSync(join(testRoot, "pubspec.yaml"), "name: demo", "utf-8");
    writeFileSync(join(testRoot, "pom.xml"), "<project />", "utf-8");
    writeFileSync(join(testRoot, "Cargo.toml"), "[package]", "utf-8");

    expect(detectStackFingerprints(testRoot)).toEqual([
      "nodejs",
      "go",
      "python",
      "flutter",
      "java",
      "rust",
    ]);
  });

  it("caches fingerprints and invalidates them when the folder mtime changes", () => {
    // 1. Initially empty folder
    expect(detectStackFingerprints(testRoot)).toEqual([]);

    // 2. Write package.json - this changes folder mtime, cache should be invalidated
    writeFileSync(join(testRoot, "package.json"), "{}", "utf-8");
    expect(detectStackFingerprints(testRoot)).toEqual(["nodejs"]);

    // 3. Write go.mod - this changes folder mtime, cache should be invalidated again
    writeFileSync(join(testRoot, "go.mod"), "module demo", "utf-8");
    expect(detectStackFingerprints(testRoot)).toEqual(["nodejs", "go"]);
  });
});
