import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetReaderCache,
  getNextSeq,
  readAllEntries,
  readLastCompleted,
  readLastIncomplete,
  readRecentEntries,
} from "../src/ctx-reader.js";
import { ensureCtxFile, getCtxPath } from "../src/ctx-path.js";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function todayPrefix(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `cid-${yyyy}${mm}${dd}-`;
}

describe("ctx-reader", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-ctx-reader-"));
    ensureCtxFile(testRoot);
    _resetReaderCache();
  });

  afterEach(() => {
    _resetReaderCache();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("reads entries, normalizes ids, ignores malformed lines, and reuses cache", () => {
    const ctxPath = getCtxPath(testRoot);
    writeFileSync(
      ctxPath,
      [
        JSON.stringify({
          ts: "2026-05-19T10:00:00.000Z",
          correlation_id: "cid-20260519-7",
          status: "started",
        }),
        JSON.stringify({
          ts: "2026-05-19T10:01:00.000Z",
          trace_id: "trace-20260519-0000000000000008",
          status: "done",
        }),
        "{broken",
      ].join("\n"),
      "utf-8",
    );

    const firstRead = readAllEntries(testRoot);
    const secondRead = readAllEntries(testRoot);

    expect(firstRead).toHaveLength(3);
    expect(firstRead[0]).toMatchObject({
      correlation_id: "cid-20260519-7",
      trace_id: "trace-20260519-0000000000000007",
      span_id: "span-00000007",
    });
    expect(firstRead[1]).toMatchObject({
      correlation_id: "trace-20260519-0000000000000008",
    });
    expect(firstRead[2]).toMatchObject({
      event: "system_warning",
      type: "corrupted_jsonl_line",
    });
    expect(secondRead).toBe(firstRead);
  });

  it("returns cached recent entries when the file is unchanged", () => {
    const ctxPath = getCtxPath(testRoot);
    writeFileSync(
      ctxPath,
      [
        JSON.stringify({ ts: "1", correlation_id: "cid-1", status: "started" }),
        JSON.stringify({ ts: "2", correlation_id: "cid-2", status: "done" }),
        JSON.stringify({ ts: "3", correlation_id: "cid-3", status: "failed" }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const allEntries = readAllEntries(testRoot);
    const recentEntries = readRecentEntries(testRoot, 2);

    expect(recentEntries).toEqual(allEntries.slice(-2));
  });

  it("tail-reads recent entries from large files", () => {
    const ctxPath = getCtxPath(testRoot);
    const lines: string[] = [];
    for (let i = 0; i < 2200; i++) {
      lines.push(
        JSON.stringify({
          ts: `2026-05-19T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
          correlation_id: `cid-20260519-${i + 1}`,
          status: "started",
          payload: "x".repeat(40),
        }),
      );
    }
    writeFileSync(ctxPath, lines.join("\n") + "\n", "utf-8");

    const recentEntries = readRecentEntries(testRoot, 3);

    expect(recentEntries).toHaveLength(3);
    expect(recentEntries.map((entry) => entry.correlation_id)).toEqual([
      "cid-20260519-2198",
      "cid-20260519-2199",
      "cid-20260519-2200",
    ]);
  });

  it("finds the last incomplete and last completed entries and computes next seq", () => {
    const prefix = todayPrefix();
    const ctxPath = getCtxPath(testRoot);
    writeFileSync(
      ctxPath,
      [
        JSON.stringify({
          ts: "2026-05-18T10:04:00.000Z",
          correlation_id: "cid-20260518-99",
          status: "started",
        }),
        JSON.stringify({
          ts: "2026-05-19T10:00:00.000Z",
          correlation_id: `${prefix}1`,
          status: "started",
        }),
        JSON.stringify({
          ts: "2026-05-19T10:01:00.000Z",
          correlation_id: `${prefix}1`,
          status: "done",
        }),
        JSON.stringify({
          ts: "2026-05-19T10:02:00.000Z",
          correlation_id: `${prefix}2`,
          status: "started",
        }),
        JSON.stringify({
          ts: "2026-05-19T10:03:00.000Z",
          correlation_id: `${prefix}2`,
          status: "failed",
        }),
        JSON.stringify({
          ts: "2026-05-19T10:04:00.000Z",
          correlation_id: `${prefix}3`,
          status: "started",
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    expect(readLastIncomplete(testRoot)).toMatchObject({
      correlation_id: `${prefix}3`,
      status: "started",
    });
    expect(readLastCompleted(testRoot)).toMatchObject({
      correlation_id: `${prefix}1`,
      status: "done",
    });
    expect(getNextSeq(testRoot)).toBe(4);
  });

  it("returns an empty list for missing or unreadable ctx files", () => {
    const ctxPath = getCtxPath(testRoot);
    rmSync(ctxPath, { force: true });

    expect(readAllEntries(testRoot)).toEqual([]);
    expect(readRecentEntries(testRoot, 5)).toEqual([]);
    expect(existsSync(ctxPath)).toBe(false);
  });
});
