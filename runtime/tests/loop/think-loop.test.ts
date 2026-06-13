import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runThinkLoop } from "../../src/loop/think-loop.js";
import { runExecutionLoop } from "../../src/loop/execution-loop.js";
import { existsSync, rmSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/loop/execution-loop.js", () => ({
  runExecutionLoop: vi.fn(),
}));

describe("think-loop", () => {
  let testRoot: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-think-loop-"));
    originalEnv = { ...process.env };
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should run the think loop successfully and return the execution loop results", async () => {
    vi.mocked(runExecutionLoop).mockResolvedValue({
      passed: true,
      reason: "Design sheet successfully passed all Clean Architecture & DDD guardrail checks.",
      iterations: 1,
      tokensUsed: 100,
      durationMs: 10,
      history: [],
    });

    const result = await runThinkLoop({
      goal: "Implement Auth Service",
      targetDesignPath: join(testRoot, ".ritsu/design-sheet.md"),
    });

    expect(result.passed).toBe(true);
    expect(result.reason).toContain("passed all Clean Architecture");
    expect(runExecutionLoop).toHaveBeenCalled();
    expect(existsSync(join(testRoot, ".ritsu/design-sheet.md"))).toBe(true);
  });
});
