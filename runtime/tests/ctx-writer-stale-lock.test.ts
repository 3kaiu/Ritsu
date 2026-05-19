import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockCheckLock = vi.hoisted(() => vi.fn());
const mockLock = vi.hoisted(() => vi.fn());

vi.mock("proper-lockfile", () => ({
  check: mockCheckLock,
  lock: mockLock,
}));

import { ensureCtxFile, getCtxPath } from "../src/ctx-path.js";
import { _resetWriterCache, appendEvent } from "../src/ctx-writer.js";

describe("ctx-writer stale lock cleanup", () => {
  let testRoot: string;
  let release: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-ctx-writer-lock-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    ensureCtxFile(testRoot);
    _resetWriterCache();
    release = vi.fn().mockResolvedValue(undefined);
    mockCheckLock.mockReset();
    mockLock.mockReset();
    mockCheckLock.mockResolvedValue(true);
    mockLock.mockResolvedValue(release);
  });

  afterEach(() => {
    _resetWriterCache();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  function buildEvent(correlationId: string) {
    return {
      correlation_id: correlationId,
      status: "started",
      ts: "2026-05-19T11:00:00.000Z",
    };
  }

  it("removes stale ctx lock files before appending", async () => {
    const ctxPath = getCtxPath(testRoot);
    const lockPath = `${ctxPath}.lock`;
    writeFileSync(lockPath, "stale", "utf-8");
    mockCheckLock.mockResolvedValue(false);
    mockLock.mockImplementation(async (lockedPath: string) => {
      expect(lockedPath).toBe(ctxPath);
      expect(existsSync(lockPath)).toBe(false);
      return release;
    });

    const result = await appendEvent(testRoot, buildEvent("cid-test-1"));

    expect(result.lineCount).toBe(1);
    expect(existsSync(lockPath)).toBe(false);
    expect(readFileSync(ctxPath, "utf-8")).toContain('"correlation_id":"cid-test-1"');
  });

  it("removes unreadable ctx lock markers before appending", async () => {
    const ctxPath = getCtxPath(testRoot);
    const lockPath = `${ctxPath}.lock`;
    writeFileSync(lockPath, "broken", "utf-8");
    mockCheckLock.mockRejectedValue(new Error("lock metadata unreadable"));
    mockLock.mockImplementation(async () => {
      expect(existsSync(lockPath)).toBe(false);
      return release;
    });

    const result = await appendEvent(testRoot, buildEvent("cid-test-2"));

    expect(result.lineCount).toBe(1);
    expect(existsSync(lockPath)).toBe(false);
    expect(readFileSync(ctxPath, "utf-8")).toContain('"correlation_id":"cid-test-2"');
  });

  it("keeps active ctx lock files in place until release", async () => {
    const ctxPath = getCtxPath(testRoot);
    const lockPath = `${ctxPath}.lock`;
    writeFileSync(lockPath, "active", "utf-8");
    mockCheckLock.mockResolvedValue(true);
    release = vi.fn().mockImplementation(async () => {
      rmSync(lockPath, { force: true });
    });
    mockLock.mockImplementation(async (lockedPath: string) => {
      expect(lockedPath).toBe(ctxPath);
      expect(existsSync(lockPath)).toBe(true);
      return release;
    });

    const result = await appendEvent(testRoot, buildEvent("cid-test-3"));

    expect(result.lineCount).toBe(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(existsSync(lockPath)).toBe(false);
    expect(readFileSync(ctxPath, "utf-8")).toContain('"correlation_id":"cid-test-3"');
  });
});
