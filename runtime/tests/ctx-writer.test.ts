import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  _resetWriterCache,
  appendEvent,
  getCtxFilePath,
  resetLineCount,
  syncLineCountFromCtxFile,
} from "../src/ctx-writer.js";
import { getCtxPath, ensureCtxFile } from "../src/ctx-path.js";
import { _resetCorrelationCache } from "../src/correlation.js";
import {
  existsSync,
  readFileSync,
  rmSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ctx-writer", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-ctx-writer-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    ensureCtxFile(testRoot);
    _resetWriterCache();
    _resetCorrelationCache();
  });

  afterEach(() => {
    _resetWriterCache();
    _resetCorrelationCache();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should append a valid event to the log", async () => {
    const event = {
      correlation_id: "cid-test-1",
      status: "started",
      skill: "think",
      timestamp: new Date().toISOString()
    };

    await appendEvent(testRoot, event);

    const ctxPath = getCtxPath(testRoot);
    const content = readFileSync(ctxPath, "utf-8").trim();
    expect(content).toBe(JSON.stringify(event));
  });

  it("should handle multiple appends correctly", async () => {
    await appendEvent(testRoot, { id: 1 });
    await appendEvent(testRoot, { id: 2 });

    const ctxPath = getCtxPath(testRoot);
    const content = readFileSync(ctxPath, "utf-8").trim();
    const lines = content.split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).id).toBe(1);
    expect(JSON.parse(lines[1]).id).toBe(2);
  });

  it("generates correlation ids and increments line counts", async () => {
    const first = await appendEvent(testRoot, {
      status: "started",
      ts: "2026-05-19T10:00:00.000Z",
    });
    const second = await appendEvent(testRoot, {
      status: "done",
      ts: "2026-05-19T10:01:00.000Z",
    });

    expect(first.correlation_id).toMatch(/^cid-\d{8}-1$/);
    expect(first.lineCount).toBe(1);
    expect(second.correlation_id).toMatch(/^cid-\d{8}-2$/);
    expect(second.lineCount).toBe(2);
  });

  it("syncs the cached line count from the ctx file", async () => {
    const ctxPath = getCtxFilePath(testRoot);
    writeFileSync(ctxPath, '{"id":1}\n{"id":2}\n', "utf-8");

    resetLineCount(0);
    syncLineCountFromCtxFile(testRoot);

    const result = await appendEvent(testRoot, {
      correlation_id: "cid-manual-3",
      status: "started",
      ts: "2026-05-19T10:02:00.000Z",
    });

    expect(result.lineCount).toBe(3);
  });

  it("returns trace ids when provided and signs events if a key exists", async () => {
    writeFileSync(join(testRoot, ".ritsu", "secret.key"), "test-key", "utf-8");

    const result = await appendEvent(testRoot, {
      trace_id: "trace-20260519-abcdefabcdefabcd",
      status: "started",
      ts: "2026-05-19T10:03:00.000Z",
      artifact: "docs/design.md",
    });

    const content = readFileSync(getCtxPath(testRoot), "utf-8").trim();
    const parsed = JSON.parse(content);

    expect(result.correlation_id).toBe("trace-20260519-abcdefabcdefabcd");
    expect(parsed.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("recreates the ctx file path when requested directly", () => {
    const ctxPath = getCtxPath(testRoot);
    rmSync(ctxPath, { force: true });

    const recreatedPath = getCtxFilePath(testRoot);

    expect(recreatedPath).toBe(ctxPath);
    expect(existsSync(recreatedPath)).toBe(true);
  });
});
