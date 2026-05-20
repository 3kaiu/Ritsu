import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockLock = vi.hoisted(() => vi.fn());

vi.mock("proper-lockfile", () => ({
  lock: mockLock,
}));

import { ensureCtxFile, getCtxPath } from "../src/ctx-path.js";
import { _resetWriterCache, appendEvent } from "../src/ctx-writer.js";

describe("ctx-writer locking", () => {
  let testRoot: string;
  let release: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-ctx-writer-lock-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    ensureCtxFile(testRoot);
    _resetWriterCache();
    release = vi.fn().mockResolvedValue(undefined);
    mockLock.mockReset();
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

  it("locks the ctx file before appending and releases the lock afterwards", async () => {
    const ctxPath = getCtxPath(testRoot);
    
    const result = await appendEvent(testRoot, buildEvent("cid-test-1"));

    expect(result.lineCount).toBe(1);
    expect(mockLock).toHaveBeenCalledWith(ctxPath);
    expect(release).toHaveBeenCalledTimes(1);
    expect(readFileSync(ctxPath, "utf-8")).toContain('"correlation_id":"cid-test-1"');
  });

  it("correctly handles multiple appends, locking and releasing each time", async () => {
    const ctxPath = getCtxPath(testRoot);

    await appendEvent(testRoot, buildEvent("cid-test-2"));
    await appendEvent(testRoot, buildEvent("cid-test-3"));

    expect(mockLock).toHaveBeenCalledTimes(2);
    expect(mockLock).toHaveBeenNthCalledWith(1, ctxPath);
    expect(mockLock).toHaveBeenNthCalledWith(2, ctxPath);
    expect(release).toHaveBeenCalledTimes(2);
    
    const content = readFileSync(ctxPath, "utf-8");
    expect(content).toContain('"correlation_id":"cid-test-2"');
    expect(content).toContain('"correlation_id":"cid-test-3"');
  });
});
