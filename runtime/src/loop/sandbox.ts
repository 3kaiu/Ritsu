import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve, relative } from "node:path";
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

let isDockerCached: boolean | null = null;

export function resetDockerCache(): void {
  isDockerCached = null;
}

export function isDockerAvailable(): boolean {
  if (isDockerCached !== null) return isDockerCached;
  try {
    execSync("docker info", { stdio: "ignore", timeout: 1000 });
    isDockerCached = true;
    return true;
  } catch {
    isDockerCached = false;
    return false;
  }
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

    // Start a Docker container mounting the sandbox directory if Docker is available
    if (isDockerAvailable()) {
      const containerName = `ritsu-sandbox-${id}`;
      console.error(`[ritsu-sandbox] Starting Docker container ${containerName} for sandboxed execution...`);
      try {
        execSync(
          `docker run -d --name ${containerName} -v ${sandboxDir}:/workspace -w /workspace node:18-slim tail -f /dev/null`,
          { stdio: "ignore" }
        );
      } catch (err) {
        console.error(`[ritsu-sandbox] Failed to start Docker container:`, err);
        if (process.env.RITSU_STRICT_SANDBOX === "1") {
          throw new Error(`Strict sandbox mode enabled, but failed to start Docker container: ${err}`);
        }
      }
    } else if (process.env.RITSU_STRICT_SANDBOX === "1") {
      throw new Error(`Strict sandbox mode enabled, but Docker is not available.`);
    }
    
    const cleanup = async () => {
      console.error(`[ritsu-sandbox] Cleaning up git worktree at ${sandboxDir}...`);
      
      if (isDockerAvailable()) {
        const containerName = `ritsu-sandbox-${id}`;
        console.error(`[ritsu-sandbox] Stopping and removing Docker container ${containerName}...`);
        try {
          execSync(`docker rm -f ${containerName}`, { stdio: "ignore" });
        } catch (err) {
          console.error(`[ritsu-sandbox] Failed to stop/remove Docker container:`, err);
        }
      }

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

/**
 * Runs a command inside the Docker sandbox if available, falling back to local host execution.
 */
export async function runCommandInSandbox(
  binary: string,
  args: string[],
  options: { cwd: string; timeoutMs?: number; maxBufferMb?: number }
): Promise<{ ok: boolean; output: string }> {
  const root = getProjectRoot();
  const cwd = options.cwd;
  
  // Detect if cwd is inside a worktree sandbox
  const sandboxesDir = resolve(root, ".ritsu", "sandboxes");
  let sandboxId: string | null = null;
  
  if (cwd.startsWith(sandboxesDir)) {
    const relToSandboxes = relative(sandboxesDir, cwd);
    const parts = relToSandboxes.split("/");
    if (parts.length > 0 && parts[0]) {
      sandboxId = parts[0];
    }
  }

  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBufferMb = options.maxBufferMb ?? 10;
  const maxBytes = maxBufferMb * 1024 * 1024;
  
  if (sandboxId && isDockerAvailable()) {
    const containerName = `ritsu-sandbox-${sandboxId}`;
    try {
      // Check if container is running
      execSync(`docker inspect -f '{{.State.Running}}' ${containerName}`, { stdio: "ignore", timeout: 1000 });
      
      const sandboxDir = resolve(sandboxesDir, sandboxId);
      const relPath = relative(sandboxDir, cwd);
      const containerCwd = relPath ? `/workspace/${relPath}` : "/workspace";
      
      console.error(`[ritsu-sandbox] Running command in Docker container ${containerName} (cwd: ${containerCwd}): ${binary} ${args.join(" ")}`);
      
      return new Promise((resolvePromise) => {
        const child = spawn("docker", [
          "exec",
          "-w", containerCwd,
          containerName,
          binary,
          ...args
        ], {
          stdio: ["ignore", "pipe", "pipe"]
        });
        
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
          if (stdout.length < maxBytes) stdout += chunk.toString("utf-8");
        });
        child.stderr.on("data", (chunk: Buffer) => {
          if (stderr.length < maxBytes) stderr += chunk.toString("utf-8");
        });
        
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          resolvePromise({ ok: false, output: stdout || stderr || "timeout" });
        }, timeoutMs);
        
        child.on("close", (code) => {
          clearTimeout(timer);
          const combined = (stdout + "\n" + stderr).trim();
          resolvePromise({ ok: code === 0, output: combined });
        });
        
        child.on("error", (err) => {
          clearTimeout(timer);
          resolvePromise({ ok: false, output: err.message });
        });
      });
    } catch {
      console.error(`[ritsu-sandbox] Docker container ${containerName} not running. Falling back to host execution.`);
      if (process.env.RITSU_STRICT_SANDBOX === "1") {
        return { ok: false, output: `Strict sandbox mode enabled, but Docker container ${containerName} is not running.` };
      }
    }
  } else if (process.env.RITSU_STRICT_SANDBOX === "1" && sandboxId) {
    return { ok: false, output: `Strict sandbox mode enabled, but Docker is not available.` };
  }

  // Fall back to host execution
  return new Promise((resolvePromise) => {
    const child = spawn(binary, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < maxBytes) stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < maxBytes) stderr += chunk.toString("utf-8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolvePromise({ ok: false, output: stdout || stderr || "timeout" });
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const combined = (stdout + "\n" + stderr).trim();
      resolvePromise({ ok: code === 0, output: combined });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ ok: false, output: err.message });
    });
  });
}
