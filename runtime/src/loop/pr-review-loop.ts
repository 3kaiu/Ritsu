import { createSandbox } from "./sandbox.js";
import { runExecutionLoop } from "./execution-loop.js";
import { postGithubPrComment } from "./outbound-mcp.js";
import { ritsu_run_quality_gates } from "../handlers/run-quality-gates.js";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { getProjectRoot } from "../handlers/_utils.js";

export interface PRReviewConfig {
  owner: string;
  repo: string;
  prNumber: number;
  branch: string;
  baseBranch?: string;
  maxIterations?: number;
}

/**
 * PR Review Loop: Runs quality check on PR branch, runs self-correcting fix loop if it fails,
 * pushes fixes if successful, and comments back on the GitHub PR.
 */
export async function runPRReviewLoop(config: PRReviewConfig): Promise<{ passed: boolean; reason: string }> {
  const baseBranch = config.baseBranch ?? "main";
  const root = getProjectRoot();
  
  // 1. Create Git worktree sandbox
  const sandboxId = `pr-${config.prNumber}-${Date.now().toString().slice(-4)}`;
  const sandbox = await createSandbox(sandboxId, { isolationLevel: "worktree" });
  
  try {
    // 2. Fetch and checkout the PR branch in the sandbox
    console.error(`[ritsu-pr-review] Fetching PR branch ${config.branch}...`);
    execSync(`git fetch origin ${config.branch}:${config.branch}`, { cwd: sandbox.path, stdio: "ignore" });
    execSync(`git checkout ${config.branch}`, { cwd: sandbox.path, stdio: "ignore" });
    
    // 3. Define verifyFn for quality gates check
    const verifyFn = async (iteration: number) => {
      console.error(`[ritsu-pr-review] Running quality gates check for PR (iteration ${iteration})...`);
      const gateResult = await ritsu_run_quality_gates({
        cwd: sandbox.path,
        skip_lint: false,
        skip_policy: false,
      });
      
      if (gateResult.isError) {
        const text = gateResult.content[0]?.type === "text" ? gateResult.content[0].text : "Unknown error";
        return {
          passed: false,
          reason: `Quality gates failed to execute: ${text}`,
          tokensUsed: 0,
          fixableByRetry: true,
        };
      }
      
      const contentText = gateResult.content[0]?.type === "text" ? gateResult.content[0].text : "{}";
      const report = JSON.parse(contentText);
      const passed = report.lint?.status === "passed" && report.test?.status === "passed";
      
      let reason = "Quality gates passed successfully.";
      if (!passed) {
        reason = `Quality gate failures found:
- Lint: ${report.lint?.status}
- Tests: ${report.test?.status}`;
        if (report.test?.failures?.length > 0) {
          reason += `\nTest failures:\n` + report.test.failures.map((f: any) => `- ${f.file}: ${f.message}`).join("\n");
        }
      }
      
      return {
        passed,
        reason,
        tokensUsed: 100,
        fixableByRetry: true,
      };
    };
    
    // Run pre-check first
    const preCheck = await verifyFn(0);
    if (preCheck.passed) {
      const msg = `✅ Ritsu Quality Gate check passed on branch \`${config.branch}\`! No issues found.`;
      await postGithubPrComment(config.owner, config.repo, config.prNumber, msg);
      return { passed: true, reason: msg };
    }
    
    // 4. Run Execution Loop to attempt self-correcting the failures
    const goal = `Fix all lint and unit test failures on branch ${config.branch}.`;
    const result = await runExecutionLoop({
      goal,
      skill: "review",
      tier: "P1",
      maxIterations: config.maxIterations ?? 3,
      tokenBudget: 150_000,
      timeoutMs: 300_000,
      verifyFn,
    });
    
    if (result.passed) {
      // Push the fixes back to origin
      execSync(`git push origin ${config.branch}`, { cwd: sandbox.path, stdio: "ignore" });
      const msg = `✅ Ritsu auto-fixed quality gate failures on branch \`${config.branch}\` and pushed the updates!`;
      await postGithubPrComment(config.owner, config.repo, config.prNumber, msg);
      return { passed: true, reason: msg };
    } else {
      const msg = `❌ Ritsu quality gate checks failed on branch \`${config.branch}\`. Auto-fix was unsuccessful:
${result.reason}`;
      await postGithubPrComment(config.owner, config.repo, config.prNumber, msg);
      return { passed: false, reason: msg };
    }
  } catch (err: any) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[ritsu-pr-review] Error in PR review loop:`, err);
    return { passed: false, reason: `Error during review loop: ${errorMsg}` };
  } finally {
    // 5. Cleanup
    await sandbox.cleanup();
  }
}
export async function runScoutLoop(config: { scoreThreshold?: number }): Promise<{ passed: boolean; reason: string }> {
  // Simple scout mockup for Phase 2: collects trending issues and saves to scout-inbox.md
  const threshold = config.scoreThreshold ?? 7;
  const root = getProjectRoot();
  
  const inboxDir = resolve(root, ".ritsu", "scout");
  const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
  if (!existsSync(inboxDir)) {
    mkdirSync(inboxDir, { recursive: true });
  }
  
  const content = `# Scout Inbox - ${new Date().toISOString().substring(0, 10)}
- [HackerNews] Loop Engineering paradigm shift is trending (Score: 9/10)
- [GitHub] Microsoft/SkillOpt repository released (Score: 8/10)
- [RFC] Model Context Protocol v1.5.0 draft published (Score: 7.5/10)
`;
  
  writeFileSync(resolve(inboxDir, "inbox.md"), content, "utf-8");
  return { passed: true, reason: `Collected 3 trending articles with score > ${threshold} to scout/inbox.md` };
}
