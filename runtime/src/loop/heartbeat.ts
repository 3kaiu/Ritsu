import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot } from "../handlers/_utils.js";
import { runTestAugmentLoop } from "./test-augment-loop.js";
import { runPRReviewLoop, runScoutLoop } from "./pr-review-loop.js";
import { runThinkLoop } from "./think-loop.js";

export interface HeartbeatConfig {
  id: string;                      // e.g. "pr-review-loop"
  cron: string;                    // e.g. "*/30 * * * *"
  taskType: string;                // "test-augment" | "pr-review" | "scout" | "bug-hunt"
  taskParams: Record<string, any>;
  enabled: boolean;
  lastRun?: string;                // ISO timestamp
  consecutiveFailures: number;
  maxConsecutiveFailures: number;  // Disable task if consecutiveFailures >= maxConsecutiveFailures
}

function getHeartbeatsFilePath(projectRoot: string): string {
  const ritsuDir = resolve(projectRoot, ".ritsu");
  if (!existsSync(ritsuDir)) {
    mkdirSync(ritsuDir, { recursive: true });
  }
  return resolve(ritsuDir, "heartbeats.json");
}

export function loadHeartbeats(projectRoot: string): HeartbeatConfig[] {
  const filePath = getHeartbeatsFilePath(projectRoot);
  if (!existsSync(filePath)) return [];
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as HeartbeatConfig[];
  } catch {
    return [];
  }
}

export function saveHeartbeats(projectRoot: string, configs: HeartbeatConfig[]): void {
  const filePath = getHeartbeatsFilePath(projectRoot);
  writeFileSync(filePath, JSON.stringify(configs, null, 2), "utf-8");
}

function matchCronField(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") return true;

  if (field.includes(",")) {
    return field.split(",").some((part) => matchCronField(part, value, min, max));
  }

  const stepMatch = field.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = parseInt(stepMatch[1], 10);
    return value % step === 0;
  }

  const rangeMatch = field.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    return value >= start && value <= end;
  }

  const exactVal = parseInt(field, 10);
  if (!isNaN(exactVal)) {
    return value === exactVal;
  }

  return false;
}

/**
 * Check if current date matches the cron expression.
 */
export function matchCron(pattern: string, date = new Date()): boolean {
  const parts = pattern.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const min = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1; // 0-indexed to 1-indexed
  const dow = date.getDay(); // 0 is Sunday

  return (
    matchCronField(parts[0], min, 0, 59) &&
    matchCronField(parts[1], hour, 0, 23) &&
    matchCronField(parts[2], dom, 1, 31) &&
    matchCronField(parts[3], month, 1, 12) &&
    matchCronField(parts[4], dow, 0, 6)
  );
}

// Global registry of task runners
const registry: Record<string, (params: any) => Promise<{ passed: boolean; reason: string }>> = {
  "test-augment": async (params) => {
    return runTestAugmentLoop({
      targetFile: params.targetFile,
      testFile: params.testFile,
      targetCoverage: params.targetCoverage,
      maxIterations: params.maxIterations,
      tokenBudget: params.tokenBudget,
      timeoutMs: params.timeoutMs,
    });
  },
  "pr-review": async (params) => {
    return runPRReviewLoop({
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      branch: params.branch,
      baseBranch: params.baseBranch,
      maxIterations: params.maxIterations,
    });
  },
  "scout": async (params) => {
    return runScoutLoop({
      scoreThreshold: params.scoreThreshold,
    });
  },
  "think-refinement": async (params) => {
    return runThinkLoop({
      goal: params.goal,
      targetDesignPath: params.targetDesignPath,
      maxIterations: params.maxIterations,
      tokenBudget: params.tokenBudget,
      timeoutMs: params.timeoutMs,
    });
  },
};

export function registerTaskRunner(
  type: string,
  runner: (params: any) => Promise<{ passed: boolean; reason: string }>,
) {
  registry[type] = runner;
}

let schedulerTimer: Timer | null = null;
let lastTickMinute = -1;

/**
 * Start the heartbeat scheduler loop.
 */
export function startHeartbeatScheduler(intervalMs = 30000): void {
  if (schedulerTimer) return;

  const projectRoot = getProjectRoot();
  console.error(`[ritsu-heartbeat] Starting scheduler loop...`);

  schedulerTimer = setInterval(async () => {
    const now = new Date();
    const currentMinute = Math.floor(now.getTime() / 60000);
    
    // Prevent multiple runs in the same minute tick
    if (currentMinute === lastTickMinute) return;
    lastTickMinute = currentMinute;

    const configs = loadHeartbeats(projectRoot);
    let updated = false;

    for (const config of configs) {
      if (!config.enabled) continue;

      if (matchCron(config.cron, now)) {
        console.error(`[ritsu-heartbeat] Triggering job: ${config.id} (${config.taskType})`);
        updated = true;
        config.lastRun = now.toISOString();

        const runner = registry[config.taskType];
        if (!runner) {
          console.error(`[ritsu-heartbeat] Runner for task type '${config.taskType}' not registered.`);
          config.consecutiveFailures++;
          if (config.consecutiveFailures >= config.maxConsecutiveFailures) {
            config.enabled = false;
            console.error(`[ritsu-heartbeat] Job ${config.id} auto-disabled due to consecutive failures.`);
          }
          continue;
        }

        // Run runner in background to avoid blocking scheduler tick
        runner(config.taskParams)
          .then((res) => {
            console.error(`[ritsu-heartbeat] Job ${config.id} completed. Passed: ${res.passed}, Reason: ${res.reason}`);
            
            // Reload configs to avoid race conditions with other runs
            const currentConfigs = loadHeartbeats(projectRoot);
            const ref = currentConfigs.find((c) => c.id === config.id);
            if (ref) {
              if (res.passed) {
                ref.consecutiveFailures = 0;
              } else {
                ref.consecutiveFailures++;
                if (ref.consecutiveFailures >= ref.maxConsecutiveFailures) {
                  ref.enabled = false;
                  console.error(`[ritsu-heartbeat] Job ${ref.id} auto-disabled due to consecutive failures.`);
                }
              }
              saveHeartbeats(projectRoot, currentConfigs);
            }
          })
          .catch((err) => {
            console.error(`[ritsu-heartbeat] Job ${config.id} crashed:`, err);
            
            const currentConfigs = loadHeartbeats(projectRoot);
            const ref = currentConfigs.find((c) => c.id === config.id);
            if (ref) {
              ref.consecutiveFailures++;
              if (ref.consecutiveFailures >= ref.maxConsecutiveFailures) {
                ref.enabled = false;
              }
              saveHeartbeats(projectRoot, currentConfigs);
            }
          });
      }
    }

    if (updated) {
      saveHeartbeats(projectRoot, configs);
    }
  }, intervalMs);
}

/**
 * Stop the heartbeat scheduler loop.
 */
export function stopHeartbeatScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    lastTickMinute = -1;
    console.error(`[ritsu-heartbeat] Scheduler loop stopped.`);
  }
}

/**
 * Trigger a registered loop directly.
 */
export async function triggerJobDirectly(projectRoot: string, jobId: string): Promise<{ passed: boolean; reason: string }> {
  const configs = loadHeartbeats(projectRoot);
  const config = configs.find((c) => c.id === jobId);
  if (!config) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const runner = registry[config.taskType];
  if (!runner) {
    throw new Error(`Runner for task type '${config.taskType}' not registered.`);
  }

  return runner(config.taskParams);
}
