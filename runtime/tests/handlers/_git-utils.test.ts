import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { runGit } from "../../src/handlers/_git-utils.js";

function createChildProcessMock() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

describe("runGit", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns stdout when git exits successfully", async () => {
    spawnMock.mockImplementation((binary, args, options) => {
      expect(binary).toBe("git");
      expect(args).toEqual(["status"]);
      expect(options).toMatchObject({
        cwd: "/tmp/repo",
        stdio: ["ignore", "pipe", "pipe"],
      });

      const child = createChildProcessMock();
      process.nextTick(() => {
        child.stdout.emit("data", Buffer.from(" M src/index.ts\n"));
        child.emit("close", 0);
      });
      return child;
    });

    const result = await runGit(["status"], "/tmp/repo");

    expect(result).toEqual({
      ok: true,
      output: "M src/index.ts",
    });
  });

  it("returns stderr when git exits with a failure", async () => {
    spawnMock.mockImplementation(() => {
      const child = createChildProcessMock();
      process.nextTick(() => {
        child.stderr.emit("data", Buffer.from("fatal: not a git repository\n"));
        child.emit("close", 128);
      });
      return child;
    });

    const result = await runGit(["status"], "/tmp/repo");

    expect(result).toEqual({
      ok: false,
      output: "fatal: not a git repository",
    });
  });

  it("returns the spawn error message when git cannot be launched", async () => {
    spawnMock.mockImplementation(() => {
      const child = createChildProcessMock();
      process.nextTick(() => {
        child.emit("error", new Error("spawn git ENOENT"));
      });
      return child;
    });

    const result = await runGit(["status"], "/tmp/repo");

    expect(result).toEqual({
      ok: false,
      output: "spawn git ENOENT",
    });
  });
});
