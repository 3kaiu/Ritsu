import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { syncPush, syncPull } from "../src/sync.js";
import { existsSync, rmSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

describe("ritsu sync", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-sync-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;

    // init git repo
    execSync("git init", { cwd: testRoot, stdio: "ignore" });
    // create initial commit to avoid empty repo issues
    writeFileSync(join(testRoot, "README.md"), "# Test Repo");
    execSync("git add README.md", { cwd: testRoot, stdio: "ignore" });
    execSync("git commit -m 'init'", { cwd: testRoot, stdio: "ignore" });
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should push .ritsu to detached ref and pull it successfully", () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir);
    const testFile = join(ritsuDir, "test.txt");
    writeFileSync(testFile, "hello sync");

    // Push should succeed
    const pushOk = syncPush();
    expect(pushOk).toBe(true);

    // Verify ref exists
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: testRoot })
      .toString()
      .trim();
    const ref = `refs/ritsu/${branch}`;
    const refCommit = execSync(`git rev-parse ${ref}`, { cwd: testRoot }).toString().trim();
    expect(refCommit.length).toBe(40);

    // Remove local .ritsu
    rmSync(ritsuDir, { recursive: true, force: true });
    expect(existsSync(testFile)).toBe(false);

    // Pull should restore it
    const pullOk = syncPull();
    expect(pullOk).toBe(true);

    // Verify file is restored
    expect(existsSync(testFile)).toBe(true);
    expect(readFileSync(testFile, "utf-8")).toBe("hello sync");
  });

  it("should fail gracefully if not a git repo", () => {
    // Delete .git
    rmSync(join(testRoot, ".git"), { recursive: true, force: true });

    mkdirSync(join(testRoot, ".ritsu"));
    writeFileSync(join(testRoot, ".ritsu", "test.txt"), "hello sync");

    expect(syncPush()).toBe(false);
    expect(syncPull()).toBe(false);
  });
});
