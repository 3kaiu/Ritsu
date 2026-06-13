import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { runDaemon } from "../../src/cli/daemon.js";
import { writeFileSync, existsSync, readFileSync, rmSync, mkdirSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    spawn: vi.fn().mockReturnValue({
      pid: 12345,
      unref: vi.fn(),
    }),
    spawnSync: vi.fn().mockReturnValue({ status: 0 }),
  };
});

describe("ritsu daemon CLI", () => {
  let testRoot: string;
  let originalProjectRoot: string | undefined;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let killSpy: any;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-daemon-"));
    originalProjectRoot = process.env.RITSU_PROJECT_ROOT;
    process.env.RITSU_PROJECT_ROOT = testRoot;
    mkdirSync(resolve(testRoot, ".ritsu"), { recursive: true });

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalProjectRoot === undefined) {
      delete process.env.RITSU_PROJECT_ROOT;
    } else {
      process.env.RITSU_PROJECT_ROOT = originalProjectRoot;
    }
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("should report daemon as stopped initially", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as any);

    expect(() => runDaemon(["status"])).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Ritsu daemon is stopped."));
  });

  it("should start daemon and write PID file", () => {
    runDaemon(["start"]);
    const pidFile = resolve(testRoot, ".ritsu/daemon.pid");
    expect(existsSync(pidFile)).toBe(true);
    expect(readFileSync(pidFile, "utf-8")).toBe("12345");
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("started in background"));
  });

  it("should report daemon as running when PID file exists and process is active", () => {
    const pidFile = resolve(testRoot, ".ritsu/daemon.pid");
    writeFileSync(pidFile, "12345", "utf-8");

    // Process.kill mock makes it seem alive
    killSpy.mockImplementation((pid: number, signal: string | number) => {
      if (pid === 12345 && signal === 0) return true;
      return true;
    });

    runDaemon(["status"]);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Ritsu daemon is running (PID: 12345)."));
  });

  it("should stop running daemon", () => {
    const pidFile = resolve(testRoot, ".ritsu/daemon.pid");
    writeFileSync(pidFile, "12345", "utf-8");

    killSpy.mockImplementation((pid: number, signal: string | number) => {
      // Simulate process exit after receiving SIGTERM
      if (signal === "SIGTERM") {
        killSpy.mockImplementation(() => {
          throw new Error("process not found"); // Process is now dead
        });
      }
      return true;
    });

    runDaemon(["stop"]);
    expect(existsSync(pidFile)).toBe(false);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Ritsu daemon stopped."));
  });
});
