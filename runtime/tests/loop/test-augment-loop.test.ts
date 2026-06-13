import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runTestAugmentLoop } from "../../src/loop/test-augment-loop.js";
import { launchAgent } from "../../src/handlers/launch-agent.js";
import { ritsu_run_quality_gates } from "../../src/handlers/run-quality-gates.js";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

vi.mock("../../src/handlers/launch-agent.js", () => ({
  launchAgent: vi.fn().mockImplementation(async () => {
    return {
      agent_id: "mock-agent",
      prompt: "",
      agent_type: "claude",
      ok: true,
      output: "Mock agent added test cases",
      exit_code: 0,
      duration_ms: 10,
      started_at: new Date().toISOString(),
    };
  }),
}));

vi.mock("../../src/handlers/run-quality-gates.js", () => ({
  ritsu_run_quality_gates: vi.fn(),
}));

describe("runTestAugmentLoop", () => {
  let testRoot: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-augment-loop-"));
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

  it("completes successfully when coverage meets target", async () => {
    let callCount = 0;
    
    // Mock run quality gates to simulate coverage improvement
    vi.mocked(ritsu_run_quality_gates).mockImplementation(async () => {
      callCount++;
      const coveragePct = callCount === 1 ? 50 : 85;
      
      const report = {
        lint: { status: "passed", output: "" },
        test: { status: "passed", failures: [], output: "" },
        coverage: {
          summary: {
            lines: { total: 100, covered: coveragePct, pct: coveragePct }
          },
          per_file: {
            "src/loop/execution-loop.ts": {
              lines: { total: 100, covered: coveragePct, pct: coveragePct }
            }
          }
        }
      };
      
      return {
        content: [{ type: "text", text: JSON.stringify(report) }],
        isError: false,
      };
    });

    const result = await runTestAugmentLoop({
      targetFile: "src/loop/execution-loop.ts",
      targetCoverage: 80,
      maxIterations: 3,
    });

    expect(result.passed).toBe(true);
    expect(result.iterations).toBe(2);
    expect(result.reason).toContain("Success! Coverage is 85%");
    expect(callCount).toBe(2);
  });

  it("fails and escalates when coverage target is not reached within maxIterations", async () => {
    vi.mocked(ritsu_run_quality_gates).mockImplementation(async () => {
      const report = {
        lint: { status: "passed", output: "" },
        test: { status: "passed", failures: [], output: "" },
        coverage: {
          summary: {
            lines: { total: 100, covered: 60, pct: 60 }
          },
          per_file: {
            "src/loop/execution-loop.ts": {
              lines: { total: 100, covered: 60, pct: 60 }
            }
          }
        }
      };
      
      return {
        content: [{ type: "text", text: JSON.stringify(report) }],
        isError: false,
      };
    });

    const result = await runTestAugmentLoop({
      targetFile: "src/loop/execution-loop.ts",
      targetCoverage: 80,
      maxIterations: 2,
    });

    expect(result.passed).toBe(false);
    expect(result.iterations).toBe(2);
    expect(result.reason).toContain("Max iterations reached");
  });
});
