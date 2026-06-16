import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSandbox } from "../../src/loop/sandbox.js";
import { existsSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    execSync: vi.fn().mockImplementation((cmd: string, opts: any) => {
      if (cmd.includes("docker")) {
        throw new Error("Docker mocked out");
      }
      return original.execSync(cmd, opts);
    }),
  };
});

describe("sandbox isolation", () => {
  let testRoot: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-sandbox-"));
    originalEnv = { ...process.env };
    process.env.RITSU_PROJECT_ROOT = testRoot;

    // Initialize git repository
    execSync("git init", { cwd: testRoot, stdio: "ignore" });
    writeFileSync(join(testRoot, "README.md"), "# Sandbox Test Project");
    execSync("git add README.md", { cwd: testRoot, stdio: "ignore" });
    execSync("git config user.email 'sandbox@ritsu.com'", { cwd: testRoot, stdio: "ignore" });
    execSync("git config user.name 'Sandbox Tester'", { cwd: testRoot, stdio: "ignore" });
    execSync("git commit -m 'initial commit'", { cwd: testRoot, stdio: "ignore" });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("creates and cleans up a worktree sandbox successfully", async () => {
    const sandboxId = "test-wt-sandbox";
    const sandbox = await createSandbox(sandboxId, { isolationLevel: "worktree" });

    expect(sandbox.branch).toBe("ritsu/loop/test-wt-sandbox");
    expect(existsSync(sandbox.path)).toBe(true);

    // Verify git worktree list contains the path
    const list = execSync("git worktree list", { cwd: testRoot, encoding: "utf8" });
    expect(list).toContain(sandbox.path);

    // Run cleanup
    await sandbox.cleanup();

    // Check that path and worktree are cleaned up
    expect(existsSync(sandbox.path)).toBe(false);
    const postList = execSync("git worktree list", { cwd: testRoot, encoding: "utf8" });
    expect(postList).not.toContain(sandbox.path);

    // Check branch is deleted
    const branches = execSync("git branch", { cwd: testRoot, encoding: "utf8" });
    expect(branches).not.toContain("ritsu/loop/test-wt-sandbox");
  });

  it("creates and cleans up a branch-based sandbox successfully", async () => {
    const orig = execSync("git branch --show-current", { cwd: testRoot, encoding: "utf8" }).trim();
    const sandboxId = "test-br-sandbox";
    const sandbox = await createSandbox(sandboxId, { isolationLevel: "branch" });

    expect(sandbox.branch).toBe("ritsu/loop/test-br-sandbox");
    
    // Check current branch is the sandbox branch
    const currentBranch = execSync("git branch --show-current", { cwd: testRoot, encoding: "utf8" }).trim();
    expect(currentBranch).toBe("ritsu/loop/test-br-sandbox");

    // Run cleanup
    await sandbox.cleanup();

    // Check original branch is restored
    const restoredBranch = execSync("git branch --show-current", { cwd: testRoot, encoding: "utf8" }).trim();
    expect(restoredBranch).toBe(orig);

    // Check sandbox branch is deleted
    const branches = execSync("git branch", { cwd: testRoot, encoding: "utf8" });
    expect(branches).not.toContain("ritsu/loop/test-br-sandbox");
  });
});
