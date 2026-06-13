import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSandbox, runCommandInSandbox, isDockerAvailable, resetDockerCache } from "../../src/loop/sandbox.js";
import { writeFileSync, existsSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import * as child_process from "node:child_process";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    execSync: vi.fn(),
    spawn: vi.fn(),
  };
});

describe("Containerized Sandbox Executor", () => {
  let testRoot: string;
  let mockExecSync: any;
  let mockSpawn: any;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-sandbox-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    writeFileSync(resolve(testRoot, "AGENTS.md"), "# Project Baseline\n");
    mkdirSync(resolve(testRoot, ".ritsu"));

    mockExecSync = vi.mocked(child_process.execSync);
    mockSpawn = vi.mocked(child_process.spawn);
    
    // Clear mocks
    mockExecSync.mockClear();
    mockSpawn.mockClear();
    
    // Reset cached docker status
    resetDockerCache();
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
    delete process.env.RITSU_PROJECT_ROOT;
    delete process.env.RITSU_STRICT_SANDBOX;
    vi.restoreAllMocks();
  });

  it("should detect Docker status and cache it", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("docker info output"));
    const first = isDockerAvailable();
    const second = isDockerAvailable();
    
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it("should spawn Docker container when Docker is available on sandbox creation", async () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    
    const sandbox = await createSandbox("test-123", { isolationLevel: "worktree" });
    
    expect(sandbox.path).toContain("test-123");
    const dockerRunCall = mockExecSync.mock.calls.find((call: any) => 
      call[0].includes("docker run -d --name ritsu-sandbox-test-123")
    );
    expect(dockerRunCall).toBeDefined();
  });

  it("should fail sandbox creation in strict mode if Docker is missing", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("docker info")) throw new Error("Docker not running");
      return Buffer.from("");
    });
    process.env.RITSU_STRICT_SANDBOX = "1";

    await expect(createSandbox("test-strict", { isolationLevel: "worktree" }))
      .rejects.toThrow("Strict sandbox mode enabled, but Docker is not available");
  });

  it("should clean up Docker container on cleanup", async () => {
    mockExecSync.mockReturnValue(Buffer.from(""));
    
    const sandbox = await createSandbox("test-cleanup", { isolationLevel: "worktree" });
    await sandbox.cleanup();
    
    const dockerRmCall = mockExecSync.mock.calls.find((call: any) => 
      call[0].includes("docker rm -f ritsu-sandbox-test-cleanup")
    );
    expect(dockerRmCall).toBeDefined();
  });

  it("should route runCommandInSandbox through docker exec if container is active", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("docker inspect")) return Buffer.from("true");
      return Buffer.from("");
    });

    const mockChild: any = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn().mockImplementation((event: string, callback: any) => {
        if (event === "close") {
          setTimeout(() => callback(0), 10);
        }
      }),
      kill: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockChild);

    const sandboxPath = resolve(testRoot, ".ritsu", "sandboxes", "test-run");
    const result = await runCommandInSandbox("npm", ["run", "test"], { cwd: sandboxPath });

    expect(result.ok).toBe(true);
    const spawnCall = mockSpawn.mock.calls[0];
    expect(spawnCall[0]).toBe("docker");
    expect(spawnCall[1]).toContain("exec");
    expect(spawnCall[1]).toContain("ritsu-sandbox-test-run");
    expect(spawnCall[1]).toContain("npm");
  });

  it("should fall back to host run if Docker container is missing", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("docker inspect")) throw new Error("no container");
      return Buffer.from("");
    });

    const mockChild: any = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn().mockImplementation((event: string, callback: any) => {
        if (event === "close") {
          setTimeout(() => callback(0), 10);
        }
      }),
      kill: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockChild);

    const sandboxPath = resolve(testRoot, ".ritsu", "sandboxes", "test-run");
    const result = await runCommandInSandbox("npm", ["run", "test"], { cwd: sandboxPath });

    expect(result.ok).toBe(true);
    const spawnCall = mockSpawn.mock.calls[0];
    expect(spawnCall[0]).toBe("npm");
    expect(spawnCall[1]).toContain("test");
  });
});
