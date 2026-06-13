import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot } from "../handlers/_utils.js";

export interface SandboxConfig {
  branchPrefix?: string;           // default "ritsu/loop/"
  isolationLevel?: "worktree" | "branch"; // default "worktree"
  autoCleanup?: boolean;           // default true
}

export interface Sandbox {
  path: string;
  branch: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates an isolated sandbox environment using Git Worktree or Git Branch.
 */
export async function createSandbox(
  id: string,
  config: SandboxConfig = {},
): Promise<Sandbox> {
  const root = getProjectRoot();
  const branchPrefix = config.branchPrefix ?? "ritsu/loop/";
  const isolationLevel = config.isolationLevel ?? "worktree";
  
  const branchName = `${branchPrefix}${id}`;
  
  if (isolationLevel === "worktree") {
    const sandboxDir = resolve(root, ".ritsu", "sandboxes", id);
    const sandboxesParent = resolve(root, ".ritsu", "sandboxes");
    
    if (!existsSync(sandboxesParent)) {
      mkdirSync(sandboxesParent, { recursive: true });
    }
    
    console.error(`[ritsu-sandbox] Creating git worktree at ${sandboxDir} on branch ${branchName}...`);
    
    // Add worktree and checkout a new branch from HEAD
    execSync(`git worktree add -b ${branchName} ${sandboxDir} HEAD`, {
      cwd: root,
      stdio: "ignore",
    });
    
    const cleanup = async () => {
      console.error(`[ritsu-sandbox] Cleaning up git worktree at ${sandboxDir}...`);
      try {
        execSync(`git worktree remove --force ${sandboxDir}`, { cwd: root, stdio: "ignore" });
      } catch (err) {
        console.error(`[ritsu-sandbox] Failed to remove worktree:`, err);
      }
      try {
        execSync(`git branch -D ${branchName}`, { cwd: root, stdio: "ignore" });
      } catch (err) {
        console.error(`[ritsu-sandbox] Failed to delete branch:`, err);
      }
      try {
        if (existsSync(sandboxDir)) {
          rmSync(sandboxDir, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
    };
    
    return {
      path: sandboxDir,
      branch: branchName,
      cleanup,
    };
  } else {
    // Switch to branch on the same folder
    console.error(`[ritsu-sandbox] Switching to branch ${branchName} in main working directory...`);
    
    let stashed = false;
    try {
      const status = execSync("git status --porcelain", { cwd: root, encoding: "utf8" }).trim();
      if (status) {
        execSync("git stash", { cwd: root, stdio: "ignore" });
        stashed = true;
      }
    } catch { /* ignore */ }
    
    const originalBranch = execSync("git branch --show-current", { cwd: root, encoding: "utf8" }).trim();
    
    execSync(`git checkout -b ${branchName}`, { cwd: root, stdio: "ignore" });
    
    const cleanup = async () => {
      console.error(`[ritsu-sandbox] Restoring original branch ${originalBranch}...`);
      try {
        execSync(`git checkout ${originalBranch}`, { cwd: root, stdio: "ignore" });
      } catch { /* ignore */ }
      try {
        execSync(`git branch -D ${branchName}`, { cwd: root, stdio: "ignore" });
      } catch { /* ignore */ }
      if (stashed) {
        try {
          execSync("git stash pop", { cwd: root, stdio: "ignore" });
        } catch { /* ignore */ }
      }
    };
    
    return {
      path: root,
      branch: branchName,
      cleanup,
    };
  }
}
