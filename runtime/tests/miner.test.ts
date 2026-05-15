import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { minePreferences } from "../src/miner.js";
import { existsSync, rmSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

describe("ritsu mine", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-miner-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;

    // init git repo
    execSync("git init", { cwd: testRoot, stdio: "ignore" });
    writeFileSync(join(testRoot, "README.md"), "# Test Repo");
    execSync("git add README.md", { cwd: testRoot, stdio: "ignore" });
    execSync("git config user.email 'test@example.com'", { cwd: testRoot, stdio: "ignore" });
    execSync("git config user.name 'Test'", { cwd: testRoot, stdio: "ignore" });
    execSync("git commit -m 'init'", { cwd: testRoot, stdio: "ignore" });
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should generate a mining sheet when human overrides AI artifacts", () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir);

    const codeFile = join(testRoot, "index.ts");
    // 1. AI writes file
    writeFileSync(codeFile, "console.log('hello');");
    execSync("git add index.ts", { cwd: testRoot, stdio: "ignore" });
    execSync("git commit -m 'feat: AI commit'", { cwd: testRoot, stdio: "ignore" });

    // AI records the write event just before the commit
    const ts = new Date(Date.now() - 1000 * 60).toISOString(); // 1 minute ago
    const ctxFile = join(ritsuDir, "ctx-20260515.jsonl");
    const event = { ts, status: "artifact_written", artifact: "index.ts" };
    writeFileSync(ctxFile, JSON.stringify(event) + "\n");

    // 2. Human overrides file
    writeFileSync(codeFile, "logger.info('hello');");
    execSync("git add index.ts", { cwd: testRoot, stdio: "ignore" });
    execSync("git commit -m 'fix: human override'", { cwd: testRoot, stdio: "ignore" });

    // Run miner
    const sheetPath = minePreferences(7);
    expect(sheetPath).toBeTruthy();
    expect(existsSync(sheetPath!)).toBe(true);

    const sheetContent = readFileSync(sheetPath!, "utf-8");
    expect(sheetContent).toContain("logger.info('hello');");
    expect(sheetContent).toContain("-console.log('hello');");
  });

  it("should return null if no corrections are found", () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir);

    const codeFile = join(testRoot, "index.ts");
    // 1. AI writes file
    writeFileSync(codeFile, "console.log('hello');");
    
    // AI records the write event
    const ts = new Date().toISOString();
    const ctxFile = join(ritsuDir, "ctx-20260515.jsonl");
    const event = { ts, status: "artifact_written", artifact: "index.ts" };
    writeFileSync(ctxFile, JSON.stringify(event) + "\n");

    // No human override...
    
    // Run miner
    const sheetPath = minePreferences(7);
    expect(sheetPath).toBeNull();
  });
});
