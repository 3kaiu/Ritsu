import { runExecutionLoop, type LoopConfig, type LoopResult } from "./execution-loop.js";
import { ritsu_run_quality_gates } from "../handlers/run-quality-gates.js";
import { getProjectRoot } from "../handlers/_utils.js";
import { resolve, relative } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export interface TestAugmentConfig {
  targetFile: string;              // e.g. "runtime/src/loop/execution-loop.ts"
  testFile?: string;               // e.g. "runtime/tests/loop/execution-loop.test.ts"
  targetCoverage?: number;         // default 80
  maxIterations?: number;          // default 5
  tokenBudget?: number;            // default 200_000
  timeoutMs?: number;              // default 600_000 (10 minutes)
}

/**
 * Test Augment Loop: Automatically drive coverage improvements for a specific file.
 */
export async function runTestAugmentLoop(config: TestAugmentConfig): Promise<LoopResult> {
  const root = getProjectRoot();
  const targetCoverage = config.targetCoverage ?? 80;
  
  // Resolve paths
  const absoluteTargetFile = resolve(root, config.targetFile);
  const relativeTargetFile = relative(root, absoluteTargetFile);
  
  const goal = `Automatically augment test coverage for ${relativeTargetFile} to reach at least ${targetCoverage}%.
Target File: ${relativeTargetFile}
${config.testFile ? `Test File to modify: ${config.testFile}` : `Please locate or create the appropriate test file for ${relativeTargetFile}.`}`;

  const verifyFn = async (iteration: number, lastFeedback?: string) => {
    console.error(`[ritsu-loop-augment] Running Quality Gates to check test status and coverage...`);
    
    const gateResult = await ritsu_run_quality_gates({
      skip_lint: false,
      skip_policy: true, // skip policy preflight to speed up and avoid false flags
    });
    
    if (gateResult.isError) {
      const text = gateResult.content[0]?.type === "text" ? gateResult.content[0].text : "Unknown error";
      return {
        passed: false,
        reason: `Quality gates failed to run: ${text}`,
        tokensUsed: 0,
        fixableByRetry: true,
      };
    }
    
    const contentText = gateResult.content[0]?.type === "text" ? gateResult.content[0].text : "{}";
    const report = JSON.parse(contentText);
    
    // Check if lint or test failed
    if (report.lint?.status === "failed") {
      return {
        passed: false,
        reason: `Lint check failed:\n${report.lint.output}`,
        tokensUsed: 100,
        fixableByRetry: true,
      };
    }
    
    if (report.test?.status === "failed") {
      const failures = report.test.failures || [];
      const failReason = failures.length > 0 
        ? failures.map((f: any) => `${f.file}: ${f.message}`).join("\n")
        : report.test.output;
      return {
        passed: false,
        reason: `Tests failed:\n${failReason}`,
        tokensUsed: 100,
        fixableByRetry: true,
      };
    }
    
    // Read coverage
    const coverage = report.coverage;
    if (!coverage || !coverage.per_file) {
      return {
        passed: false,
        reason: `No coverage report found. Ensure that 'npm run test:coverage' or equivalent is configured to produce coverage-summary.json.`,
        tokensUsed: 50,
        fixableByRetry: false, // if config is broken, retrying won't help
      };
    }
    
    // Find matching coverage for targetFile
    let targetStats = coverage.per_file[relativeTargetFile];
    if (!targetStats) {
      // try matching by absolute path resolution
      for (const [key, stats] of Object.entries(coverage.per_file)) {
        if (resolve(root, key) === absoluteTargetFile) {
          targetStats = stats as any;
          break;
        }
      }
    }
    
    if (!targetStats) {
      return {
        passed: false,
        reason: `Could not find coverage metrics for ${relativeTargetFile} in the coverage report. Keys found: ${Object.keys(coverage.per_file).join(", ")}`,
        tokensUsed: 50,
        fixableByRetry: true,
      };
    }
    
    const linesPct = targetStats.lines?.pct ?? targetStats.statements?.pct ?? 0;
    console.error(`[ritsu-loop-augment] Current coverage for ${relativeTargetFile} is ${linesPct}% (Target: ${targetCoverage}%)`);
    
    if (linesPct >= targetCoverage) {
      return {
        passed: true,
        reason: `Success! Coverage is ${linesPct}% (>= target ${targetCoverage}%)`,
        tokensUsed: 50,
        fixableByRetry: true,
      };
    }
    
    // If not met, we need more tests!
    return {
      passed: false,
      reason: `Tests passed, but coverage is only ${linesPct}% (Target is ${targetCoverage}%). Please add more test cases targeting untested paths in ${relativeTargetFile}.`,
      tokensUsed: 100,
      fixableByRetry: true,
    };
  };

  return runExecutionLoop({
    goal,
    skill: "augment",
    tier: config.targetCoverage && config.targetCoverage >= 90 ? "P2" : "P1",
    maxIterations: config.maxIterations ?? 5,
    tokenBudget: config.tokenBudget ?? 200_000,
    timeoutMs: config.timeoutMs ?? 600_000,
    verifyFn,
  });
}
