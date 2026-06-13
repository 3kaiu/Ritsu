import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runPRReviewLoop, runScoutLoop } from "../../src/loop/pr-review-loop.js";
import { ritsu_run_quality_gates } from "../../src/handlers/run-quality-gates.js";
import { runExecutionLoop } from "../../src/loop/execution-loop.js";
import { postGithubPrComment } from "../../src/loop/outbound-mcp.js";
import { createSandbox } from "../../src/loop/sandbox.js";
import { existsSync, rmSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

vi.mock("../../src/loop/sandbox.js", () => ({
  createSandbox: vi.fn(),
}));

vi.mock("../../src/handlers/run-quality-gates.js", () => ({
  ritsu_run_quality_gates: vi.fn(),
}));

vi.mock("../../src/loop/execution-loop.js", () => ({
  runExecutionLoop: vi.fn(),
}));

vi.mock("../../src/loop/outbound-mcp.js", () => ({
  postGithubPrComment: vi.fn().mockResolvedValue(true),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue(Buffer.from("")),
}));

describe("pr-review-loop", () => {
  let testRoot: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-pr-review-"));
    originalEnv = { ...process.env };
    process.env.RITSU_PROJECT_ROOT = testRoot;

    vi.mocked(execSync).mockClear();
    vi.mocked(execSync).mockReturnValue(Buffer.from(""));

    // mock git commands inside sandbox
    vi.mocked(createSandbox).mockResolvedValue({
      path: testRoot,
      branch: "ritsu/loop/pr-42",
      cleanup: vi.fn(),
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("passes immediately if preflight checks pass", async () => {
    // Mock quality gates passing
    vi.mocked(ritsu_run_quality_gates).mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ lint: { status: "passed" }, test: { status: "passed" } }) }],
      isError: false,
    });

    const result = await runPRReviewLoop({
      owner: "3kaiu",
      repo: "Ritsu",
      prNumber: 42,
      branch: "feature-branch",
    });

    expect(result.passed).toBe(true);
    expect(result.reason).toContain("passed on branch `feature-branch`");
    expect(postGithubPrComment).toHaveBeenCalledWith("3kaiu", "Ritsu", 42, expect.stringContaining("passed on branch `feature-branch`"));
    expect(runExecutionLoop).not.toHaveBeenCalled();
  });

  it("attempts to fix and succeeds when quality gates fail initially", async () => {
    let callCount = 0;
    vi.mocked(ritsu_run_quality_gates).mockImplementation(async () => {
      callCount++;
      const status = callCount === 1 ? "failed" : "passed";
      const report = {
        lint: { status: "passed" },
        test: { status, failures: status === "failed" ? [{ file: "test.ts", message: "Failed assert" }] : [] },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(report) }],
        isError: false,
      };
    });

    vi.mocked(runExecutionLoop).mockResolvedValue({
      passed: true,
      reason: "Fixed everything",
      iterations: 1,
      tokensUsed: 100,
      durationMs: 10,
      history: [],
    });

    const result = await runPRReviewLoop({
      owner: "3kaiu",
      repo: "Ritsu",
      prNumber: 42,
      branch: "feature-branch",
    });

    expect(result.passed).toBe(true);
    expect(result.reason).toContain("auto-fixed quality gate failures");
    expect(postGithubPrComment).toHaveBeenCalledWith("3kaiu", "Ritsu", 42, expect.stringContaining("auto-fixed"));
    expect(execSync).toHaveBeenCalledWith("git push origin feature-branch", expect.any(Object));
  });

  it("comments failure if execution loop fails to fix the issues", async () => {
    vi.mocked(ritsu_run_quality_gates).mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ lint: { status: "failed" }, test: { status: "passed" } }) }],
      isError: false,
    });

    vi.mocked(runExecutionLoop).mockResolvedValue({
      passed: false,
      reason: "Could not fix lint",
      iterations: 3,
      tokensUsed: 300,
      durationMs: 30,
      history: [],
    });

    const result = await runPRReviewLoop({
      owner: "3kaiu",
      repo: "Ritsu",
      prNumber: 42,
      branch: "feature-branch",
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("Auto-fix was unsuccessful");
    expect(postGithubPrComment).toHaveBeenCalledWith("3kaiu", "Ritsu", 42, expect.stringContaining("Auto-fix was unsuccessful"));
  });

  describe("runScoutLoop", () => {
    it("runs scout loop successfully and outputs md report", async () => {
      const result = await runScoutLoop({ scoreThreshold: 7 });
      expect(result.passed).toBe(true);
      expect(existsSync(join(testRoot, ".ritsu", "scout", "inbox.md"))).toBe(true);
      const text = readFileSync(join(testRoot, ".ritsu", "scout", "inbox.md"), "utf-8");
      expect(text).toContain("Microsoft/SkillOpt");
    });
  });
});
