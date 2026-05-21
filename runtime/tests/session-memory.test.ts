import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, rmSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// Mock native-bridge: computeSimpleEmbedding is used by searchMemories
vi.mock("../src/native-bridge.js", () => ({
  isNativeAvailable: () => false,
  initNativeStore: () => false,
  computeSimpleEmbedding: (text: string, dims = 128) =>
    new Array(dims).fill(0).map(() => Math.random()),
  searchSimilarViolations: () => [],
}));

describe("session-memory", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-memory-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;

    // Create .ritsu dir
    const ritsuDir = resolve(testRoot, ".ritsu");
    mkdirSync(ritsuDir, { recursive: true });
  });

  afterEach(() => {
    delete process.env.RITSU_PROJECT_ROOT;
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("captureMemory writes to JSONL index", async () => {
    const { captureMemory } = await import("../src/session-memory.js");
    const ok = captureMemory({
      type: "decision",
      summary: "Use const over let",
      detail: "Team decided to enforce const for all immutable bindings",
      project: "test-project",
      tags: ["coding-style", "preference"],
    });
    expect(ok).toBe(true);

    const memPath = resolve(testRoot, ".ritsu/memories/index.jsonl");
    expect(existsSync(memPath)).toBe(true);
    const content = await import("node:fs").then((fs) => fs.readFileSync(memPath, "utf-8"));
    expect(content).toContain("Use const over let");
    expect(content).toContain("decision");
  });

  it("searchMemories returns results after capture", async () => {
    const { captureMemory, searchMemories } = await import("../src/session-memory.js");
    captureMemory({ type: "pattern", summary: "Singleton pattern", detail: "Used for DB connection", project: "test", tags: ["pattern"] });
    captureMemory({ type: "bugfix", summary: "Fixed null pointer", detail: "Added null check before access", project: "test", tags: ["bug"] });

    const hits = searchMemories("null pointer");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].type).toBe("bugfix");
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("getMemoryTimeline returns surrounding entries", async () => {
    const { captureMemory, searchMemories, getMemoryTimeline } = await import("../src/session-memory.js");
    captureMemory({ type: "decision", summary: "Decision A", detail: "First", project: "test", tags: [] });
    captureMemory({ type: "decision", summary: "Decision B", detail: "Second", project: "test", tags: [] });
    captureMemory({ type: "decision", summary: "Decision C", detail: "Third", project: "test", tags: [] });

    const hits = searchMemories("Decision B");
    expect(hits.length).toBeGreaterThanOrEqual(1);

    const timeline = getMemoryTimeline(hits[0].id, 1);
    expect(timeline.length).toBeGreaterThanOrEqual(2);
  });

  it("getMemoryDetails returns full entries by IDs", async () => {
    const { captureMemory, searchMemories, getMemoryDetails } = await import("../src/session-memory.js");
    captureMemory({ type: "preference", summary: "Prefer async/await", detail: "Over raw promises", project: "test", tags: ["async"] });

    const hits = searchMemories("async/await");
    expect(hits.length).toBeGreaterThanOrEqual(1);

    const details = getMemoryDetails([hits[0].id]);
    expect(details.length).toBe(1);
    expect(details[0].detail).toBe("Over raw promises");
  });

  it("autoCaptureOnEvent captures violations", async () => {
    const { autoCaptureOnEvent, searchMemories } = await import("../src/session-memory.js");
    autoCaptureOnEvent({
      ts: "20260522-120000",
      skill: "dev",
      status: "violation_detected",
      violation: { rule_id: "AP-6", message: "Placeholder found", evidence: "TODO comment in code" },
    });

    const hits = searchMemories("Placeholder found");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].type).toBe("violation");
  });

  it("autoCaptureOnEvent captures preference artifacts", async () => {
    const { autoCaptureOnEvent, searchMemories } = await import("../src/session-memory.js");
    autoCaptureOnEvent({
      ts: "20260522-120000",
      skill: "miner",
      status: "artifact_written",
      artifact: "pref-auto-const",
    });

    const hits = searchMemories("pref-auto-const");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].type).toBe("preference");
  });

  it("returns empty results from non-existent memory file", async () => {
    const { searchMemories, getMemoryTimeline, getMemoryDetails } = await import("../src/session-memory.js");
    expect(searchMemories("anything")).toEqual([]);
    expect(getMemoryTimeline("nonexistent")).toEqual([]);
    expect(getMemoryDetails(["nonexistent"])).toEqual([]);
  });
});
