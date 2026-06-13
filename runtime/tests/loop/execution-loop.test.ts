import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runExecutionLoop, type LoopConfig } from "../../src/loop/execution-loop.js";
import { launchAgent } from "../../src/handlers/launch-agent.js";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

vi.mock("../../src/handlers/launch-agent.js", () => {
  return {
    launchAgent: vi.fn().mockImplementation(async () => {
      return {
        agent_id: "mock-agent",
        prompt: "",
        agent_type: "claude",
        ok: true,
        output: "Mock agent completed work",
        exit_code: 0,
        duration_ms: 10,
        started_at: new Date().toISOString(),
      };
    }),
  };
});

describe("runExecutionLoop", () => {
  let testRoot: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-execution-loop-"));
    originalEnv = { ...process.env };
    process.env.RITSU_PROJECT_ROOT = testRoot;
    execSync("git init", { cwd: testRoot, stdio: "ignore" });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("succeeds immediately when verifyFn passes on first iteration", async () => {
    const config: LoopConfig = {
      goal: "ensure tests are green",
      skill: "dev",
      tier: "P0",
      maxIterations: 5,
      tokenBudget: 10000,
      timeoutMs: 10000,
      verifyFn: async (iteration) => {
        return {
          passed: true,
          reason: "Verification passed",
          tokensUsed: 100,
          fixableByRetry: true,
        };
      },
    };

    const result = await runExecutionLoop(config);
    expect(result.passed).toBe(true);
    expect(result.iterations).toBe(1);
    expect(result.reason).toBe("Verification passed");
    expect(result.history.length).toBe(1);
    expect(result.history[0].verdict.passed).toBe(true);
  });

  it("retries and passes on second iteration (self-correction)", async () => {
    let callCount = 0;
    const config: LoopConfig = {
      goal: "ensure lint errors are fixed",
      skill: "dev",
      tier: "P0",
      maxIterations: 5,
      tokenBudget: 10000,
      timeoutMs: 10000,
      verifyFn: async (iteration) => {
        callCount++;
        if (callCount === 1) {
          return {
            passed: false,
            reason: "Found 1 lint error",
            tokensUsed: 100,
            fixableByRetry: true,
          };
        }
        return {
          passed: true,
          reason: "Verification passed",
          tokensUsed: 50,
          fixableByRetry: true,
        };
      },
    };

    const result = await runExecutionLoop(config);
    expect(result.passed).toBe(true);
    expect(result.iterations).toBe(2);
    expect(result.history.length).toBe(2);
    expect(result.history[0].verdict.passed).toBe(false);
    expect(result.history[1].verdict.passed).toBe(true);
  });

  it("stops and escalates when maxIterations is exceeded", async () => {
    let escalateCalled = false;
    const config: LoopConfig = {
      goal: "make it pass",
      skill: "dev",
      tier: "P0",
      maxIterations: 3,
      tokenBudget: 10000,
      timeoutMs: 10000,
      verifyFn: async () => {
        return {
          passed: false,
          reason: "Still failing",
          tokensUsed: 100,
          fixableByRetry: true,
        };
      },
      onEscalate: () => {
        escalateCalled = true;
      },
    };

    const result = await runExecutionLoop(config);
    expect(result.passed).toBe(false);
    expect(result.iterations).toBe(3);
    expect(result.reason).toContain("Max iterations reached");
    expect(escalateCalled).toBe(true);
  });

  it("stops when token budget is exceeded", async () => {
    const config: LoopConfig = {
      goal: "infinite task",
      skill: "dev",
      tier: "P0",
      maxIterations: 10,
      tokenBudget: 100, // very low budget
      timeoutMs: 10000,
      verifyFn: async () => {
        return {
          passed: false,
          reason: "Still failing",
          tokensUsed: 200, // exceeds budget in one step
          fixableByRetry: true,
        };
      },
    };

    const result = await runExecutionLoop(config);
    expect(result.passed).toBe(false);
    // Since verification adds 200 tokens, the budget tracks it. In next iteration, budget check fails.
    expect(result.iterations).toBe(2); // stopped at iteration 2 start
    expect(result.reason).toContain("Token budget exceeded");
  });

  it("stops immediately when a non-retryable error is encountered", async () => {
    let escalateCalled = false;
    const config: LoopConfig = {
      goal: "correct architecture mismatch",
      skill: "dev",
      tier: "P0",
      maxIterations: 5,
      tokenBudget: 10000,
      timeoutMs: 10000,
      verifyFn: async () => {
        return {
          passed: false,
          reason: "Architecture design rule violation (hard constraint)",
          tokensUsed: 50,
          fixableByRetry: false, // non-retryable!
        };
      },
      onEscalate: () => {
        escalateCalled = true;
      },
    };

    const result = await runExecutionLoop(config);
    expect(result.passed).toBe(false);
    expect(result.iterations).toBe(1);
    expect(result.reason).toContain("non-retryable error");
    expect(escalateCalled).toBe(true);
  });
});
