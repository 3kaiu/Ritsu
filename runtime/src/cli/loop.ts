import { readdirSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { detectProjectRoot } from "../project-root.js";
import { loadHeartbeats, triggerJobDirectly } from "../loop/heartbeat.js";
import { loadLoopHistory } from "../context-lifecycle.js";
import { color } from "./shared.js";

export async function runLoop(cmdArgs: string[]) {
  const action = cmdArgs[0];
  const root = detectProjectRoot();

  if (action === "list") {
    const configs = loadHeartbeats(root);
    if (configs.length === 0) {
      console.log(color("No loops registered in heartbeats.json.", "yellow"));
      return;
    }

    console.log(color("Registered Loops:", "cyan"));
    console.log("=".repeat(80));
    for (const c of configs) {
      const statusText = c.enabled ? color("ENABLED", "green") : color("DISABLED", "red");
      console.log(`ID:        ${c.id}`);
      console.log(`Type:      ${c.taskType}`);
      console.log(`Status:    ${statusText}`);
      console.log(`Cron:      ${c.cron}`);
      console.log(`Last Run:  ${c.lastRun ?? "Never"}`);
      console.log(`Failures:  ${c.consecutiveFailures} / ${c.maxConsecutiveFailures}`);
      console.log("-".repeat(80));
    }
    return;
  }

  if (action === "trigger") {
    const jobId = cmdArgs[1];
    if (!jobId) {
      console.error(color("❌ Missing loop ID. Usage: ritsu loop trigger <loop-id>", "red"));
      process.exit(1);
    }

    try {
      console.log(color(`Triggering loop '${jobId}' in foreground...`, "cyan"));
      const res = await triggerJobDirectly(root, jobId);
      if (res.passed) {
        console.log(color(`✅ Loop passed: ${res.reason}`, "green"));
      } else {
        console.error(color(`❌ Loop failed: ${res.reason}`, "red"));
        process.exit(1);
      }
    } catch (err: any) {
      console.error(color(`❌ Error triggering loop: ${err.message}`, "red"));
      process.exit(1);
    }
    return;
  }

  if (action === "status") {
    let traceId = cmdArgs[1];
    const checkpointDir = resolve(root, ".ritsu/checkpoints/loops");

    if (!traceId) {
      if (existsSync(checkpointDir)) {
        const files = readdirSync(checkpointDir).filter(
          (f) => f.startsWith("loop-cp-") && f.endsWith(".json")
        );
        if (files.length > 0) {
          let latestFile = files[0];
          let latestTime = 0;
          for (const f of files) {
            try {
              const stats = statSync(resolve(checkpointDir, f));
              if (stats.mtimeMs > latestTime) {
                latestTime = stats.mtimeMs;
                latestFile = f;
              }
            } catch { /* ignore */ }
          }
          const match = latestFile.match(/^loop-cp-(.+)-\d+\.json$/);
          if (match) {
            traceId = match[1];
          }
        }
      }
    }

    if (!traceId) {
      console.log(color("No loop execution history found.", "yellow"));
      return;
    }

    console.log(color(`Loop History for Trace: ${traceId}`, "cyan"));
    console.log("=".repeat(80));

    const history = loadLoopHistory(root, traceId);
    if (history.length === 0) {
      console.log(color("No checkpoints recorded for this trace.", "yellow"));
      return;
    }

    for (const cp of history) {
      const statusText = cp.verdict.passed ? color("PASSED", "green") : color("FAILED", "red");
      console.log(`[Iteration ${cp.iteration}] @ ${cp.ts}`);
      console.log(`  Verdict:        ${statusText}`);
      console.log(`  Reason:         ${cp.verdict.reason}`);
      console.log(`  Files Changed:  ${cp.files_changed.join(", ") || "none"}`);
      console.log("-".repeat(80));
    }
    return;
  }

  if (action === "resume") {
    const traceId = cmdArgs[1];
    const inputIdx = cmdArgs.findIndex((arg) => arg === "--input" || arg === "-i");
    const input = inputIdx !== -1 && cmdArgs[inputIdx + 1] ? cmdArgs[inputIdx + 1] : "";
    
    if (!traceId) {
      console.error(color("❌ Missing trace ID. Usage: ritsu loop resume <trace-id> --input \"<guidance>\"", "red"));
      process.exit(1);
    }
    
    if (!input) {
      console.error(color("❌ Missing input guidance. Usage: ritsu loop resume <trace-id> --input \"<guidance>\"", "red"));
      process.exit(1);
    }
    
    const interruptFile = resolve(root, ".ritsu", "pending_interrupt.json");
    if (!existsSync(interruptFile)) {
      console.error(color("❌ No active loop is currently suspended/waiting for intervention.", "red"));
      process.exit(1);
    }
    
    try {
      const { readFileSync: rFS, writeFileSync: wFS } = require("node:fs");
      const content = rFS(interruptFile, "utf-8");
      const data = JSON.parse(content);
      
      if (data.trace_id !== traceId) {
        console.error(color(`❌ Suspended loop trace ID '${data.trace_id}' does not match requested trace ID '${traceId}'.`, "red"));
        process.exit(1);
      }
      
      data.status = "resolved";
      data.input = input;
      
      wFS(interruptFile, JSON.stringify(data, null, 2), "utf-8");
      console.log(color(`✅ Loop ${traceId} successfully resumed with input: "${input}"`, "green"));
    } catch (err: any) {
      console.error(color(`❌ Failed to resume loop: ${err.message}`, "red"));
      process.exit(1);
    }
    return;
  }

  console.error(color(`Unknown loop command: ${action}. Use list, trigger, status, or resume.`, "red"));
  process.exit(1);
}
