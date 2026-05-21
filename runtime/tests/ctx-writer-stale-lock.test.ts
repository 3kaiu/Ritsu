import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ensureCtxFile, getCtxPath } from "../src/ctx-path.js";
import { _resetWriterCache, appendEvent } from "../src/ctx-writer.js";

describe("ctx-writer append", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-ctx-writer-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    ensureCtxFile(testRoot);
    _resetWriterCache();
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

  it("appends event to ctx file", async () => {
    const ctxPath = getCtxPath(testRoot);
    const result = await appendEvent(testRoot, buildEvent("cid-test-1"));
    expect(result.correlation_id).toBe("cid-test-1");
    expect(readFileSync(ctxPath, "utf-8")).toContain('"correlation_id":"cid-test-1"');
  });

  it("handles multiple appends", async () => {
    const ctxPath = getCtxPath(testRoot);
    await appendEvent(testRoot, buildEvent("cid-test-2"));
    await appendEvent(testRoot, buildEvent("cid-test-3"));

    const content = readFileSync(ctxPath, "utf-8");
    expect(content).toContain('"correlation_id":"cid-test-2"');
    expect(content).toContain('"correlation_id":"cid-test-3"');
    expect(content.split("\n").filter((l) => l.trim())).toHaveLength(2);
  });
});
