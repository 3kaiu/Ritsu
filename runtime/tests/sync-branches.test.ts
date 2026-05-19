import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockRandomUUID = vi.hoisted(() => vi.fn(() => "test-id"));

vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
}));

vi.mock("node:crypto", () => ({
  randomUUID: mockRandomUUID,
}));

import { syncPull, syncPush } from "../src/sync.js";

describe("ritsu sync fallback branches", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-sync-branches-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    mkdirSync(join(testRoot, ".git"), { recursive: true });
    mockExecSync.mockReset();
    mockRandomUUID.mockReturnValue("test-id");
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  function asBuffer(value: string): Buffer {
    return Buffer.from(value, "utf-8");
  }

  it("falls back to main and cleans the temp index when push setup fails", () => {
    mkdirSync(join(testRoot, ".ritsu"), { recursive: true });
    const tmpIndex = join(testRoot, ".git", "ritsu-index-test-id");
    writeFileSync(tmpIndex, "stale", "utf-8");

    mockExecSync.mockImplementation((command: string) => {
      if (command === "git rev-parse --is-inside-work-tree") return asBuffer("true\n");
      if (command === "git rev-parse --abbrev-ref HEAD") {
        throw new Error("branch lookup failed");
      }
      if (command === "git add -f .ritsu") {
        throw new Error("git add failed");
      }
      throw new Error(`unexpected command: ${command}`);
    });

    expect(syncPush()).toBe(false);
    expect(existsSync(tmpIndex)).toBe(false);
    expect(mockExecSync).toHaveBeenCalledWith(
      "git add -f .ritsu",
      expect.objectContaining({
        cwd: testRoot,
        stdio: "ignore",
        env: expect.objectContaining({
          GIT_INDEX_FILE: tmpIndex,
        }),
      }),
    );
  });

  it("returns false when pull cannot find the detached ref locally", () => {
    mockExecSync.mockImplementation((command: string) => {
      if (command === "git rev-parse --is-inside-work-tree") return asBuffer("true\n");
      if (command === "git rev-parse --abbrev-ref HEAD") return asBuffer("\n");
      if (command === "git fetch origin refs/ritsu/main:refs/ritsu/main") {
        throw new Error("remote ref missing");
      }
      if (command === "git rev-parse --verify refs/ritsu/main") {
        throw new Error("local ref missing");
      }
      throw new Error(`unexpected command: ${command}`);
    });

    expect(syncPull()).toBe(false);
    expect(existsSync(join(testRoot, ".ritsu"))).toBe(false);
  });

  it("creates .ritsu and returns false when archive extraction fails", () => {
    mockExecSync.mockImplementation((command: string) => {
      if (command === "git rev-parse --is-inside-work-tree") return asBuffer("true\n");
      if (command === "git rev-parse --abbrev-ref HEAD") return asBuffer("feature/test\n");
      if (
        command === "git fetch origin refs/ritsu/feature/test:refs/ritsu/feature/test"
      ) {
        return asBuffer("");
      }
      if (command === "git rev-parse --verify refs/ritsu/feature/test") {
        return asBuffer("abc123\n");
      }
      if (command === "git archive refs/ritsu/feature/test | tar -x -C .") {
        throw new Error("archive failed");
      }
      throw new Error(`unexpected command: ${command}`);
    });

    expect(syncPull()).toBe(false);
    expect(existsSync(join(testRoot, ".ritsu"))).toBe(true);
  });
});
