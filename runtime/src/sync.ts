import { execSync } from "node:child_process";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { getProjectRoot } from "./handlers/_utils.js";
import { randomUUID } from "node:crypto";

const RITSU_DIR = ".ritsu";

/**
 * Gets the current Git branch.
 * Returns 'main' as fallback if not in a git repo or detached head.
 */
function getCurrentBranch(root: string): string {
  try {
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
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pushes the .ritsu directory to a detached git ref (refs/ritsu/<branch>)
 */
export function syncPush(): boolean {
  const root = getProjectRoot();
  const ritsuDir = resolve(root, RITSU_DIR);

  if (!isGitRepo(root)) return false;
  if (!existsSync(ritsuDir)) return false;

  const branch = getCurrentBranch(root);
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
    try {
      execSync(`git push origin ${refName}:${refName} --force`, { cwd: root, stdio: "ignore" });
    } catch {
      // It's okay if push fails (e.g. no internet or no origin)
      // The local ref is still updated.
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
      } catch {}
    }
  }
}

/**
 * Pulls the detached git ref and extracts it to the local .ritsu directory
 */
export function syncPull(): boolean {
  const root = getProjectRoot();
  
  if (!isGitRepo(root)) return false;

  const branch = getCurrentBranch(root);
  const refName = `refs/ritsu/${branch}`;

  try {
    // 1. Fetch the ref from origin
    try {
      execSync(`git fetch origin ${refName}:${refName}`, { cwd: root, stdio: "ignore" });
    } catch {
      // Fetch might fail if remote doesn't have it, we can still try to extract from local ref
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

    // 3. Extract the contents
    // git archive outputs the tree content. 
    // Since we added `.ritsu` directly, the tree contains a `.ritsu` folder at the root.
    execSync(`git archive ${refName} | tar -x -C .`, { cwd: root, stdio: "ignore" });

    return true;
  } catch (e) {
    return false;
  }
}
