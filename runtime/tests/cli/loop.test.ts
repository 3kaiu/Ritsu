import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { runLoop } from "../../src/cli/loop.js";
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import * as heartbeat from "../../src/loop/heartbeat.js";
import * as contextLifecycle from "../../src/context-lifecycle.js";

describe("ritsu loop CLI", () => {
  let testRoot: string;
  let originalProjectRoot: string | undefined;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-loop-"));
    originalProjectRoot = process.env.RITSU_PROJECT_ROOT;
    process.env.RITSU_PROJECT_ROOT = testRoot;

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalProjectRoot === undefined) {
      delete process.env.RITSU_PROJECT_ROOT;
    } else {
      process.env.RITSU_PROJECT_ROOT = originalProjectRoot;
    }
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("should list registered loops", async () => {
    const loadHeartbeatsSpy = vi.spyOn(heartbeat, "loadHeartbeats").mockReturnValue([
      {
        id: "test-loop-1",
        cron: "*/5 * * * *",
        taskType: "test-augment",
        taskParams: {},
        enabled: true,
        consecutiveFailures: 0,
        maxConsecutiveFailures: 3,
        lastRun: "2026-06-13T12:00:00.000Z",
      },
    ]);

    await runLoop(["list"]);
    expect(loadHeartbeatsSpy).toHaveBeenCalledWith(testRoot);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("test-loop-1"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("test-augment"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("ENABLED"));
  });

  it("should trigger loop directly", async () => {
    const triggerJobSpy = vi.spyOn(heartbeat, "triggerJobDirectly").mockResolvedValue({
      passed: true,
      reason: "Everything is green",
    });

    await runLoop(["trigger", "test-loop-1"]);
    expect(triggerJobSpy).toHaveBeenCalledWith(testRoot, "test-loop-1");
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Everything is green"));
  });

  it("should report status of loop checkpoints for a trace", async () => {
    const loadLoopHistorySpy = vi.spyOn(contextLifecycle, "loadLoopHistory").mockReturnValue([
      {
        ts: "2026-06-13T12:00:00.000Z",
        trace_id: "trace-xyz",
        iteration: 1,
        verdict: { passed: true, reason: "Passed quality gates" },
        files_changed: ["src/index.ts"],
      },
    ]);

    await runLoop(["status", "trace-xyz"]);
    expect(loadLoopHistorySpy).toHaveBeenCalledWith(testRoot, "trace-xyz");
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Iteration 1"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Passed quality gates"));
  });

  it("should auto-select the latest trace ID if none provided", async () => {
    const checkpointDir = resolve(testRoot, ".ritsu/checkpoints/loops");
    mkdirSync(checkpointDir, { recursive: true });

    // Write a mock checkpoint file
    writeFileSync(
      resolve(checkpointDir, "loop-cp-trace-latest-0.json"),
      JSON.stringify({
        ts: "2026-06-13T12:00:00.000Z",
        trace_id: "trace-latest",
        iteration: 0,
        verdict: { passed: false, reason: "Failed lint" },
        files_changed: [],
      }),
      "utf-8"
    );

    const loadLoopHistorySpy = vi.spyOn(contextLifecycle, "loadLoopHistory").mockReturnValue([
      {
        ts: "2026-06-13T12:00:00.000Z",
        trace_id: "trace-latest",
        iteration: 0,
        verdict: { passed: false, reason: "Failed lint" },
        files_changed: [],
      },
    ]);

    await runLoop(["status"]);
    expect(loadLoopHistorySpy).toHaveBeenCalledWith(testRoot, "trace-latest");
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("trace-latest"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Failed lint"));
  });
});
