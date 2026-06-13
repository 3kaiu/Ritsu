import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { notifySlack, postGithubPrComment } from "../../src/loop/outbound-mcp.js";
import { saveLoopCheckpoint, loadLoopHistory } from "../../src/context-lifecycle.js";
import { writeFileSync, existsSync, rmSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

describe("Side-effect WAL & Idempotent Guard", () => {
  let testRoot: string;
  const traceId = "test-trace-123";
  const iteration = 1;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-idempotency-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    writeFileSync(resolve(testRoot, "AGENTS.md"), "# Project Baseline\n");
    mkdirSync(resolve(testRoot, ".ritsu"));

    // Pre-create the loop checkpoint
    saveLoopCheckpoint(
      testRoot,
      traceId,
      iteration,
      { passed: false, reason: "Running...", tokensUsed: 0, fixableByRetry: true },
      []
    );
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
    delete process.env.RITSU_PROJECT_ROOT;
    delete process.env.RITSU_TRACE_PARENT;
    vi.restoreAllMocks();
  });

  it("should log notification on host locally when trace parent is not set", async () => {
    const success = await notifySlack("Direct message without trace");
    expect(success).toBe(false); // falls back to local log, returning false

    const logPath = resolve(testRoot, ".ritsu", "slack-notifications.log");
    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("Direct message without trace");
  });

  it("should record side effect on first call and bypass on second call when trace parent is active", async () => {
    process.env.RITSU_TRACE_PARENT = `${traceId}:${iteration}`;

    // First call: runs and writes to checkpoint
    const res1 = await notifySlack("Idempotent message");
    expect(res1).toBe(false); // local log fallback returns false

    const history = loadLoopHistory(testRoot, traceId);
    expect(history.length).toBe(1);
    expect(history[0].side_effects).toBeDefined();
    expect(history[0].side_effects?.length).toBe(1);
    expect(history[0].side_effects?.[0].tool).toBe("notifySlack");
    expect(history[0].side_effects?.[0].args.message).toBe("Idempotent message");
    expect(history[0].side_effects?.[0].response).toBe(false);

    // Clear the notification log file to verify the second call doesn't write to it again
    const logPath = resolve(testRoot, ".ritsu", "slack-notifications.log");
    rmSync(logPath, { force: true });

    // Second call: should read from checkpoint and bypass execution
    const res2 = await notifySlack("Idempotent message");
    expect(res2).toBe(false); // returns cached response
    expect(existsSync(logPath)).toBe(false); // did not write to log file again
  });

  it("should not bypass if tool args change", async () => {
    process.env.RITSU_TRACE_PARENT = `${traceId}:${iteration}`;

    await notifySlack("Message 1");
    
    const logPath = resolve(testRoot, ".ritsu", "slack-notifications.log");
    expect(existsSync(logPath)).toBe(true);
    
    // Clear log file
    rmSync(logPath, { force: true });

    // Different message
    await notifySlack("Message 2");
    expect(existsSync(logPath)).toBe(true); // wrote to log file because args differed
  });
});
