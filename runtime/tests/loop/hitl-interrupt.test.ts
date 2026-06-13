import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runExecutionLoop } from "../../src/loop/execution-loop.js";
import { writeFileSync, existsSync, rmSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

// Mock launchAgent to return a stub result
vi.mock("../../src/handlers/launch-agent.js", () => {
  return {
    launchAgent: vi.fn().mockResolvedValue({
      agent_id: "agent-mock",
      prompt: "Goal...",
      agent_type: "claude",
      ok: true,
      output: "Done",
      exit_code: 0,
      duration_ms: 5,
      started_at: new Date().toISOString(),
    }),
  };
});

describe("Human-in-the-Loop Breakpoint Interrupts", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-hitl-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    process.env.RITSU_TEST_HITL = "true";
    writeFileSync(resolve(testRoot, "AGENTS.md"), "# Project Baseline\n");
    mkdirSync(resolve(testRoot, ".ritsu"));
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
    delete process.env.RITSU_PROJECT_ROOT;
    delete process.env.RITSU_TEST_HITL;
    vi.restoreAllMocks();
  });

  it("should trigger breakpoint on 3 consecutive failures and resume when resolved", async () => {
    // Override stdin TTY to simulate background daemon mode polling
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = false;

    let iterationsRun = 0;
    const verifyFn = vi.fn().mockImplementation(async (iteration: number) => {
      iterationsRun = iteration;
      return {
        passed: false,
        reason: `Failure at iteration ${iteration}`,
        tokensUsed: 100,
        fixableByRetry: true,
      };
    });

    const interruptFile = resolve(testRoot, ".ritsu", "pending_interrupt.json");

    // Start execution loop in background
    const loopPromise = runExecutionLoop({
      goal: "Test HITL breakpoint",
      skill: "review",
      tier: "P1",
      maxIterations: 4,
      tokenBudget: 100_000,
      timeoutMs: 30_000,
      verifyFn,
    });

    // Wait until the interrupt file is created (indicating loop is suspended on iteration 3)
    await new Promise<void>((resolveTimeout) => {
      const interval = setInterval(() => {
        if (existsSync(interruptFile)) {
          clearInterval(interval);
          resolveTimeout();
        }
      }, 50);
    });

    expect(existsSync(interruptFile)).toBe(true);
    const data = JSON.parse(readFileSync(interruptFile, "utf-8"));
    expect(data.status).toBe("suspended");
    expect(data.iteration).toBe(3);

    // Simulate CLI resume command: set status resolved and write user feedback input
    data.status = "resolved";
    data.input = "Try custom test fix";
    writeFileSync(interruptFile, JSON.stringify(data, null, 2), "utf-8");

    // Wait for the loop to finish
    const result = await loopPromise;

    // The loop runs for maxIterations=4.
    // Iteration 1: Fail (consecutive=1)
    // Iteration 2: Fail (consecutive=2)
    // Iteration 3: Fail (consecutive=3) -> SUSPENDED -> Resumed by user -> Reset consecutive=0
    // Iteration 4: Fail (consecutive=1) -> Ended (max iterations reached)
    expect(result.passed).toBe(false);
    expect(result.iterations).toBe(4);
    expect(verifyFn).toHaveBeenCalledTimes(4);

    // Check that prompt of iteration 4 received the user guidance
    const verifyCalls = verifyFn.mock.calls;
    // verifyFn gets called with the feedback of the previous iteration.
    // So call 4 (iteration 4) gets the feedback of iteration 3, which should contain the user input!
    expect(verifyCalls[3][1]).toContain("[User Intervention]: Try custom test fix");

    // Clean up TTY mock
    process.stdin.isTTY = originalIsTTY;
  });
});
