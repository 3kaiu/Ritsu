import { launchAgent, type AgentLaunchResult } from "../handlers/launch-agent.js";
import { LoopBudget } from "../token-budget.js";
import { saveLoopCheckpoint, type LoopVerdict } from "../context-lifecycle.js";
import { getProjectRoot } from "../handlers/_utils.js";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync, existsSync, unlinkSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import readline from "node:readline";

export interface LoopConfig {
  goal: string;
  skill: string;
  tier: "P0" | "P1" | "P2";
  maxIterations: number;
  tokenBudget: number;
  timeoutMs: number;
  verifyFn: (iteration: number, lastFeedback?: string) => Promise<LoopVerdict>;
  onEscalate?: (reason: string) => void;
  agentType?: "claude" | "codex";
}

export interface LoopResult {
  passed: boolean;
  reason: string;
  iterations: number;
  tokensUsed: number;
  durationMs: number;
  history: Array<{
    iteration: number;
    verdict: LoopVerdict;
    agentOutput?: string;
  }>;
}

/**
 * Get files changed in the git workspace compared to HEAD.
 */
function getChangedFiles(projectRoot: string): string[] {
  try {
    const output = execSync("git diff --name-only", { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const untracked = execSync("git status --porcelain", { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .filter((line) => line.startsWith("?? "))
      .map((line) => line.substring(3).trim());

    const changed = output.split("\n").map((f) => f.trim()).filter(Boolean);
    return [...new Set([...changed, ...untracked])];
  } catch {
    return [];
  }
}

/**
 * Core execution loop engine with tri-insurance controls.
 */
export async function runExecutionLoop(config: LoopConfig): Promise<LoopResult> {
  const projectRoot = getProjectRoot();
  const traceId = `loop-${randomUUID().substring(0, 8)}`;
  const startTime = Date.now();
  const budget = new LoopBudget(config.tokenBudget);
  const history: LoopResult["history"] = [];
  let consecutiveFailures = 0;

  let lastFeedback: string | undefined = undefined;
  let passed = false;
  let exitReason = "Max iterations reached without success";
  let iteration = 0;

  console.error(`[ritsu-loop] Starting execution loop for goal: "${config.goal}" | Skill: ${config.skill}`);

  for (iteration = 1; iteration <= config.maxIterations; iteration++) {
    // 1. Time budget check
    const elapsed = Date.now() - startTime;
    if (elapsed >= config.timeoutMs) {
      exitReason = `Timeout exceeded: ${elapsed}ms >= ${config.timeoutMs}ms`;
      break;
    }

    // 2. Token budget check
    if (!budget.shouldContinue()) {
      exitReason = `Token budget exceeded: Spent ${budget.getSpent()} / ${budget.getMaxBudget()}`;
      break;
    }

    console.error(`[ritsu-loop] Iteration ${iteration}/${config.maxIterations} starting...`);

    // Pre-create/initialize checkpoint file so that side effects can be recorded during iteration
    try {
      saveLoopCheckpoint(projectRoot, traceId, iteration, { passed: false, reason: "Running...", tokensUsed: 0, fixableByRetry: true }, []);
    } catch (err) {
      console.error(`[ritsu-loop] Failed to pre-initialize checkpoint:`, err);
    }

    // 3. Construct prompt incorporating feedback from previous run
    const prompt = iteration === 1
      ? `Goal: ${config.goal}\nPlease execute the task using the ${config.skill} skill.`
      : `We are running a self-correcting execution loop (iteration ${iteration}/${config.maxIterations}).
Goal: ${config.goal}

Previous attempt failed verification with the following reason:
${lastFeedback}

Please analyze the failure, make necessary code modifications to fix it, and verify your changes.`;

    const promptTokens = Math.ceil(prompt.length / 3.5);
    budget.trackUsage(promptTokens);

    // 4. Launch Agent to perform coding / fix
    let agentResult: AgentLaunchResult;
    try {
      agentResult = await launchAgent({
        prompt,
        agent_type: config.agentType ?? "claude",
        timeout_ms: Math.min(config.timeoutMs - elapsed, 300_000), // constrain to remaining time
        cwd: projectRoot,
        trace_id: traceId,
        span_id: String(iteration),
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      agentResult = {
        agent_id: "agent-error",
        prompt,
        agent_type: config.agentType ?? "claude",
        ok: false,
        output: `Agent launch failed: ${errorMsg}`,
        exit_code: -1,
        duration_ms: 0,
        started_at: new Date().toISOString(),
      };
    }

    const outputTokens = Math.ceil(agentResult.output.length / 3.5);
    budget.trackUsage(outputTokens);

    // 5. Track changed files
    const changedFiles = getChangedFiles(projectRoot);

    // 6. Run verification
    let verdict: LoopVerdict;
    try {
      verdict = await config.verifyFn(iteration, lastFeedback);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      verdict = {
        passed: false,
        reason: `Verification function threw error: ${errorMsg}`,
        tokensUsed: 0,
        fixableByRetry: false,
      };
    }

    budget.trackUsage(verdict.tokensUsed);
    lastFeedback = verdict.reason;

    // 7. Save loop checkpoint
    try {
      saveLoopCheckpoint(projectRoot, traceId, iteration, verdict, changedFiles);
    } catch (err) {
      console.error(`[ritsu-loop] Failed to save loop checkpoint:`, err);
    }

    history.push({
      iteration,
      verdict,
      agentOutput: agentResult.output,
    });

    if (!verdict.passed) {
      consecutiveFailures++;
    } else {
      consecutiveFailures = 0;
    }

    if (verdict.passed) {
      passed = true;
      exitReason = verdict.reason || "Verification passed";
      break;
    }

    // Check if we need to trigger a breakpoint interrupt
    const tokensLeft = budget.getMaxBudget() - budget.getSpent();
    const budgetLow = tokensLeft < 15_000 && budget.getMaxBudget() >= 30_000;
    
    const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
    const runHitl = isTest ? (process.env.RITSU_TEST_HITL === "true") : true;

    if ((consecutiveFailures >= 3 || budgetLow) && runHitl) {
      const reason = consecutiveFailures >= 3 
        ? `Quality gates failed 3 times consecutively.`
        : `Token budget is running low (${tokensLeft} tokens remaining).`;
        
      try {
        const userInput = await handleBreakpoint(projectRoot, traceId, iteration, reason);
        console.error(`[ritsu-loop] Resuming loop with user feedback: "${userInput}"`);
        lastFeedback = `${verdict.reason}\n\n[User Intervention]: ${userInput}`;
        consecutiveFailures = 0; // reset
        continue;
      } catch (err) {
        console.error(`[ritsu-loop] Failed to handle breakpoint:`, err);
      }
    }

    if (!verdict.fixableByRetry) {
      passed = false;
      exitReason = `Terminated: Verification failed with non-retryable error: ${verdict.reason}`;
      break;
    }
  }

  const durationMs = Date.now() - startTime;
  const totalTokens = budget.getSpent();

  console.error(`[ritsu-loop] Loop finished. Status: ${passed ? "SUCCESS" : "FAILED"}. Reason: ${exitReason}`);
  console.error(`[ritsu-loop] ${budget.formatBudgetReport()} | Duration: ${durationMs}ms`);

  if (!passed && config.onEscalate) {
    try {
      config.onEscalate(exitReason);
    } catch (err) {
      console.error(`[ritsu-loop] Failed to run onEscalate callback:`, err);
    }
  }

  return {
    passed,
    reason: exitReason,
    iterations: Math.min(iteration, config.maxIterations),
    tokensUsed: totalTokens,
    durationMs,
    history,
  };
}

async function handleBreakpoint(
  projectRoot: string,
  traceId: string,
  iteration: number,
  reason: string
): Promise<string> {
  console.error(`\n⚠️  [ritsu-loop] LOOP SUSPENDED (Trace: ${traceId}, Iteration: ${iteration})`);
  console.error(`Reason: ${reason}`);
  
  const interruptFile = resolve(projectRoot, ".ritsu", "pending_interrupt.json");
  const interruptData = {
    ts: new Date().toISOString(),
    trace_id: traceId,
    iteration,
    reason,
    status: "suspended",
  };
  
  writeFileSync(interruptFile, JSON.stringify(interruptData, null, 2), "utf-8");
  
  // If running in foreground (isTTY on stdin), prompt directly in terminal
  if (process.stdin.isTTY) {
    console.error(`[ritsu-loop] Interactive terminal detected. Please enter instructions to guide the agent, or press Enter to retry:`);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolvePrompt) => {
      rl.question("> ", (answer) => {
        rl.close();
        try { unlinkSync(interruptFile); } catch { /* ignore */ }
        resolvePrompt(answer.trim() || "Please retry and look for other solutions.");
      });
    });
  }
  
  // Otherwise (running in background daemon), poll the interrupt file until status changes to "resolved"
  console.error(`[ritsu-loop] Background daemon detected. Waiting for 'ritsu loop resume' command...`);
  return new Promise((resolvePoll) => {
    const interval = setInterval(() => {
      if (!existsSync(interruptFile)) {
        clearInterval(interval);
        resolvePoll("Please retry and look for other solutions.");
        return;
      }
      try {
        const content = readFileSync(interruptFile, "utf-8");
        const data = JSON.parse(content);
        if (data.status === "resolved") {
          clearInterval(interval);
          try { unlinkSync(interruptFile); } catch { /* ignore */ }
          resolvePoll(data.input || "Please retry and look for other solutions.");
        }
      } catch { /* ignore */ }
    }, 1000);
  });
}
