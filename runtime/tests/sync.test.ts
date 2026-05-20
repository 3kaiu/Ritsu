import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { syncPush, syncPull, getCurrentBranch, hasOriginRemote, reconcileBranchSync } from "../src/sync.js";
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
    execSync("git config user.email 'test@ritsu.dev'", { cwd: testRoot, stdio: "ignore" });
    execSync("git config user.name 'Ritsu Test'", { cwd: testRoot, stdio: "ignore" });
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

  it("should bypass push and keep the same commit SHA if .ritsu is unchanged", () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir);
    const testFile = join(ritsuDir, "test.txt");
    writeFileSync(testFile, "hello sync");

    // First push should create the ref and commit
    expect(syncPush()).toBe(true);

    const ref = "refs/ritsu/master"; // git init default branch in vitest test environment might be master or main
    let actualRef = ref;
    try {
      execSync(`git rev-parse refs/ritsu/master`, { cwd: testRoot });
    } catch {
      actualRef = "refs/ritsu/main";
    }

    const firstCommitSha = execSync(`git rev-parse ${actualRef}`, { cwd: testRoot }).toString().trim();

    // Second push with zero changes in .ritsu
    expect(syncPush()).toBe(true);

    const secondCommitSha = execSync(`git rev-parse ${actualRef}`, { cwd: testRoot }).toString().trim();

    // Must be identical because of the parent tree SHA comparison bypass
    expect(secondCommitSha).toBe(firstCommitSha);

    // Now write a new file to .ritsu
    writeFileSync(join(ritsuDir, "new.txt"), "more content");

    // Third push should create a new commit
    expect(syncPush()).toBe(true);

    const thirdCommitSha = execSync(`git rev-parse ${actualRef}`, { cwd: testRoot }).toString().trim();
    expect(thirdCommitSha).not.toBe(firstCommitSha);
  });

  it("should resolve branch name directly from .git/HEAD and support worktree gitdir syntax", () => {
    const gitPath = join(testRoot, ".git");

    // 1. Standard HEAD file
    writeFileSync(join(gitPath, "HEAD"), "ref: refs/heads/feature-xyz\n");
    expect(getCurrentBranch(testRoot)).toBe("feature-xyz");

    // 2. Mock worktree structure: .git is a file pointing to a real gitdir
    rmSync(gitPath, { recursive: true, force: true });
    const realGitDir = join(testRoot, "nested-git-dir");
    mkdirSync(realGitDir, { recursive: true });
    writeFileSync(join(realGitDir, "HEAD"), "ref: refs/heads/worktree-branch\n");
    writeFileSync(gitPath, `gitdir: ${realGitDir}\n`);

    expect(getCurrentBranch(testRoot)).toBe("worktree-branch");
  });

  it("should fail gracefully if not a git repo", () => {
    // Delete .git
    rmSync(join(testRoot, ".git"), { recursive: true, force: true });

    mkdirSync(join(testRoot, ".ritsu"));
    writeFileSync(join(testRoot, ".ritsu", "test.txt"), "hello sync");

    expect(syncPush()).toBe(false);
    expect(syncPull()).toBe(false);
  });

  it("should detect presence or absence of origin remote correctly", () => {
    // By default, git init has no remote origin
    expect(hasOriginRemote(testRoot)).toBe(false);

    // Write a mock remote origin to .git/config
    const configPath = join(testRoot, ".git", "config");
    let configContent = readFileSync(configPath, "utf-8");
    configContent += '\n[remote "origin"]\n\turl = https://github.com/3kaiu/Ritsu.git\n';
    writeFileSync(configPath, configContent, "utf-8");

    expect(hasOriginRemote(testRoot)).toBe(true);
  });

  it("should reconcile branch switches correctly by pushing old state and pulling new state", () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir, { recursive: true });

    // 1. Initial run on master
    const activeBranchFile = join(ritsuDir, ".active-branch");
    writeFileSync(join(ritsuDir, "test.txt"), "master state");

    // Establish master active branch pointer
    expect(reconcileBranchSync(testRoot)).toBe(true);
    expect(readFileSync(activeBranchFile, "utf-8").trim()).toBe(getCurrentBranch(testRoot));

    const oldBranch = getCurrentBranch(testRoot);

    // 2. Mock a branch switch by creating a new branch
    execSync("git checkout -b feature-reconcile", { cwd: testRoot, stdio: "ignore" });
    const newBranch = getCurrentBranch(testRoot);
    expect(newBranch).toBe("feature-reconcile");

    // Reconcile immediately upon switching to the new branch
    expect(reconcileBranchSync(testRoot)).toBe(true);
    expect(readFileSync(activeBranchFile, "utf-8").trim()).toBe(newBranch);

    // Verify old branch ref exists and preserves "master state"
    const oldRef = `refs/ritsu/${oldBranch}`;
    const oldRefCommit = execSync(`git rev-parse ${oldRef}`, { cwd: testRoot }).toString().trim();
    expect(oldRefCommit.length).toBe(40);

    // Now write "feature state" on the new branch
    writeFileSync(join(ritsuDir, "test.txt"), "feature state");

    // 3. Switch back to master
    execSync(`git checkout ${oldBranch}`, { cwd: testRoot, stdio: "ignore" });
    expect(getCurrentBranch(testRoot)).toBe(oldBranch);

    // Trigger reconciliation back on master branch
    expect(reconcileBranchSync(testRoot)).toBe(true);
    expect(readFileSync(activeBranchFile, "utf-8").trim()).toBe(oldBranch);

    // Verification: master context is restored back to "master state"!
    expect(readFileSync(join(ritsuDir, "test.txt"), "utf-8")).toBe("master state");
  });
});
