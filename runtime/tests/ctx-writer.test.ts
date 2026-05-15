import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendEvent } from "../src/ctx-writer.js";
import { getCtxPath, ensureCtxFile } from "../src/ctx-path.js";
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ctx-writer", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-ctx-writer-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    ensureCtxFile(testRoot);
  });

  afterEach(() => {
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
});
