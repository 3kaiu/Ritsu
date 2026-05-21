import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetReaderCache,
  readAllEntries,
  readRecentEntries,
} from "../src/ctx-reader.js";
import { ensureCtxFile, getCtxPath } from "../src/ctx-path.js";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ctx-reader resilience & self-healing", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-resilience-"));
    ensureCtxFile(testRoot);
    _resetReaderCache();
    delete process.env.RITSU_STRICT_JSONL;
  });

  afterEach(() => {
    _resetReaderCache();
    delete process.env.RITSU_STRICT_JSONL;
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("heals truncated JSON lines with missing trailing braces", () => {
    const ctxPath = getCtxPath(testRoot);
    writeFileSync(
      ctxPath,
      [
        JSON.stringify({ correlation_id: "cid-1", status: "started" }),
        '{"correlation_id": "cid-2", "status": "done"', // missing closing brace
        '{"correlation_id": "cid-3", "payload": "unclosed str', // missing closing quote and brace
      ].join("\n"),
      "utf-8"
    );

    const entries = readAllEntries(testRoot);
    // cid-1 should be fully read
    // cid-2 is healed and fully read
    // cid-3 has unclosed string quote and brace, healed to {"correlation_id": "cid-3", "payload": "unclosed str"} and fully read
    expect(entries.length).toBe(3);
    expect(entries[0]).toMatchObject({ correlation_id: "cid-1", status: "started" });
    expect(entries[1]).toMatchObject({ correlation_id: "cid-2", status: "done" });
    expect(entries[2]).toMatchObject({ correlation_id: "cid-3", payload: "unclosed str" });
  });

  it("throws error in strict mode when line is unparseable", () => {
    const ctxPath = getCtxPath(testRoot);
    writeFileSync(
      ctxPath,
      [
        JSON.stringify({ correlation_id: "cid-1", status: "started" }),
        "{broken-completely-unhealable}",
      ].join("\n"),
      "utf-8"
    );

    process.env.RITSU_STRICT_JSONL = "1";
    expect(() => readAllEntries(testRoot)).toThrow("JSONL Parse Error");
  });

  it("quarantines unhealable lines and injects system event warning in non-strict mode", () => {
    const ctxPath = getCtxPath(testRoot);
    writeFileSync(
      ctxPath,
      [
        JSON.stringify({ correlation_id: "cid-1", status: "started" }),
        "{completely broken content without braces",
      ].join("\n"),
      "utf-8"
    );

    const entries = readAllEntries(testRoot);
    // Entry 0 is the valid entry
    // Entry 1 is the injected system warning event
    expect(entries.length).toBe(2);
    expect(entries[0]).toMatchObject({ correlation_id: "cid-1", status: "started" });
    expect(entries[1]).toMatchObject({
      event: "system_warning",
      type: "corrupted_jsonl_line",
    });

    // Check quarantine file
    const quarantinePath = join(testRoot, ".ritsu", "corrupted.jsonl");
    expect(existsSync(quarantinePath)).toBe(true);
    const quarantineContent = readFileSync(quarantinePath, "utf-8");
    expect(quarantineContent).toContain("completely broken content");
  });
});
