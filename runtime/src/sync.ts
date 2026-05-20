import { execSync } from "node:child_process";
import { existsSync, rmSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { getProjectRoot } from "./handlers/_utils.js";
import { randomUUID } from "node:crypto";

const RITSU_DIR = ".ritsu";

/**
 * Gets the current Git branch.
 * Returns 'main' as fallback if not in a git repo or detached head.
 */
export function getCurrentBranch(root: string): string {
  try {
    const gitPath = join(root, ".git");
    if (!existsSync(gitPath)) return "main";

    let headPath = join(gitPath, "HEAD");
    const stat = statSync(gitPath);
    if (stat.isFile()) {
      // It's a worktree or submodule, .git is a file with: "gitdir: /path/to/real/gitdir"
      const gitDirContent = readFileSync(gitPath, "utf-8").trim();
      const match = gitDirContent.match(/^gitdir:\s*(.+)$/);
      if (match) {
        const realGitDir = match[1].trim();
        const resolvedGitDir = resolve(root, realGitDir);
        headPath = join(resolvedGitDir, "HEAD");
      }
    }

    if (existsSync(headPath)) {
      const headContent = readFileSync(headPath, "utf-8").trim();
      if (headContent.startsWith("ref: refs/heads/")) {
        return headContent.substring("ref: refs/heads/".length).trim();
      }
    }

    // Fallback to git CLI if reading HEAD directly failed (e.g. detached HEAD or other format)
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (branch === "HEAD" || !branch) return "main";
    return branch;
  } catch {
    return "main";
  }
}

/**
 * Checks if the current directory is a valid git repository.
 */
function isGitRepo(root: string): boolean {
  return existsSync(join(root, ".git"));
}

/**
 * Checks if the remote "origin" is configured in .git/config.
 */
export function hasOriginRemote(root: string): boolean {
  try {
    const gitPath = join(root, ".git");
    if (!existsSync(gitPath)) return false;

    let configPath = join(gitPath, "config");
    const stat = statSync(gitPath);
    if (stat.isFile()) {
      // It's a worktree or submodule, .git is a file with: "gitdir: /path/to/real/gitdir"
      const gitDirContent = readFileSync(gitPath, "utf-8").trim();
      const match = gitDirContent.match(/^gitdir:\s*(.+)$/);
      if (match) {
        const realGitDir = match[1].trim();
        const resolvedGitDir = resolve(root, realGitDir);
        configPath = join(resolvedGitDir, "config");
      }
    }

    if (existsSync(configPath)) {
      const configContent = readFileSync(configPath, "utf-8");
      return /\[remote\s+["']?origin["']?\]/.test(configContent);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Pushes the .ritsu directory to a detached git ref (refs/ritsu/<branch>)
 */
export function syncPush(targetBranch?: string): boolean {
  const root = getProjectRoot();
  const ritsuDir = resolve(root, RITSU_DIR);

  if (!isGitRepo(root)) return false;
  if (!existsSync(ritsuDir)) return false;

  const branch = targetBranch || getCurrentBranch(root);
  const refName = `refs/ritsu/${branch}`;

  // We use a temporary index to avoid touching the user's actual git index.
  const tmpIndex = join(root, `.git`, `ritsu-index-${randomUUID()}`);

  try {
    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };

    // 1. Force add .ritsu to the temporary index (bypassing .gitignore)
    execSync(`git add -f ${RITSU_DIR}`, { cwd: root, env, stdio: "ignore" });

    // 2. Write tree from the temporary index
    const treeSha = execSync("git write-tree", { cwd: root, env, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();

    // Check if the tree is identical to the current ref's tree to bypass committing and pushing
    try {
      const parentTreeSha = execSync(`git rev-parse ${refName}^{tree}`, {
        cwd: root,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
      if (treeSha === parentTreeSha) {
        // No changes to sync, bypass!
        return true;
      }
    } catch {
      // Ref or parent tree doesn't exist yet, which is fine
    }

    // 3. Create a commit object
    // Try to get the previous commit from this ref to maintain history, though not strictly required
    let parentArg = "";
    try {
      const parentSha = execSync(`git rev-parse ${refName}`, { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
      if (parentSha) parentArg = `-p ${parentSha}`;
    } catch {
      // Ref doesn't exist yet, which is fine
    }

    const commitSha = execSync(
      `git commit-tree ${treeSha} ${parentArg} -m "chore(ritsu): auto-sync harness context"`,
      { cwd: root, env, stdio: ["ignore", "pipe", "ignore"] },
    )
      .toString()
      .trim();

    // 4. Update the ref
    execSync(`git update-ref ${refName} ${commitSha}`, { cwd: root, stdio: "ignore" });

    // 5. Try pushing to origin
    if (hasOriginRemote(root)) {
      try {
        execSync(`git push origin ${refName}:${refName} --force`, { cwd: root, stdio: "ignore" });
      } catch {
        // It's okay if push fails (e.g. no internet)
        // The local ref is still updated.
      }
    }

    return true;
  } catch (e) {
    // Silently fail on git operations to not disrupt user flow
    return false;
  } finally {
    // Cleanup temporary index
    if (existsSync(tmpIndex)) {
      try {
        rmSync(tmpIndex, { force: true });
      } catch { /* ignore cleanup errors */ }
    }
  }
}

/**
 * Pulls the detached git ref and extracts it to the local .ritsu directory
 */
export function syncPull(targetBranch?: string): boolean {
  const root = getProjectRoot();
  
  if (!isGitRepo(root)) return false;

  const branch = targetBranch || getCurrentBranch(root);
  const refName = `refs/ritsu/${branch}`;

  try {
    // 1. Fetch the ref from origin
    if (hasOriginRemote(root)) {
      try {
        execSync(`git fetch origin ${refName}:${refName}`, { cwd: root, stdio: "ignore" });
      } catch {
        // Fetch might fail if remote doesn't have it, we can still try to extract from local ref
      }
    }

    // Check if the ref exists locally
    try {
      execSync(`git rev-parse --verify ${refName}`, { cwd: root, stdio: "ignore" });
    } catch {
      // Ref doesn't exist, nothing to pull
      return false;
    }

    // 2. Ensure .ritsu exists
    const ritsuDir = resolve(root, RITSU_DIR);
    if (!existsSync(ritsuDir)) {
      mkdirSync(ritsuDir, { recursive: true });
    }

    // 3. Extract the contents using git checkout with a temporary index file
    // to avoid dirtying the active user index.
    const tmpIndex = join(root, `.git`, `ritsu-index-${randomUUID()}`);
    try {
      const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
      execSync(`git checkout ${refName} -- ${RITSU_DIR}`, { cwd: root, env, stdio: "ignore" });
    } finally {
      if (existsSync(tmpIndex)) {
        try {
          rmSync(tmpIndex, { force: true });
        } catch { /* ignore cleanup errors */ }
      }
    }

    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Reconciles Ritsu harness state when switching Git branches.
 * Automatically saves stale context to the old branch, pulls matching new branch context,
 * and updates the active branch pointer file `.ritsu/.active-branch`.
 */
export function reconcileBranchSync(root: string): boolean {
  if (!isGitRepo(root)) return false;

  const activeBranchFile = resolve(root, RITSU_DIR, ".active-branch");
  const currentBranch = getCurrentBranch(root);

  if (existsSync(activeBranchFile)) {
    try {
      const oldBranch = readFileSync(activeBranchFile, "utf-8").trim();
      if (oldBranch && oldBranch !== currentBranch) {
        // Switch detected!
        // 1. Back up old branch state
        syncPush(oldBranch);
        // 2. Load new branch state
        syncPull(currentBranch);
      }
    } catch {
      // Ignore errors during switch recovery
    }
  }

  // Ensure the active-branch file exists and contains the current branch
  try {
    const ritsuDir = resolve(root, RITSU_DIR);
    if (!existsSync(ritsuDir)) {
      mkdirSync(ritsuDir, { recursive: true });
    }
    writeFileSync(activeBranchFile, currentBranch, "utf-8");
    return true;
  } catch {
    return false;
  }
}
