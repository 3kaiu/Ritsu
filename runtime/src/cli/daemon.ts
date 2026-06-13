import { spawn } from "node:child_process";
import { openSync, writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectProjectRoot } from "../project-root.js";
import { startHeartbeatScheduler, stopHeartbeatScheduler } from "../loop/heartbeat.js";
import { color } from "./shared.js";

export function runDaemon(cmdArgs: string[]) {
  const action = cmdArgs[0];
  const root = detectProjectRoot();
  const ritsuDir = resolve(root, ".ritsu");
  if (!existsSync(ritsuDir)) {
    mkdirSync(ritsuDir, { recursive: true });
  }
  const pidFile = resolve(ritsuDir, "daemon.pid");
  const logFile = resolve(ritsuDir, "daemon.log");

  if (action === "--foreground") {
    console.error(`[ritsu-daemon] Starting in foreground...`);
    
    const shutdown = () => {
      console.error(`[ritsu-daemon] Shutting down...`);
      stopHeartbeatScheduler();
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    startHeartbeatScheduler();
    
    // Keep process alive
    setInterval(() => {}, 60000);
    return;
  }

  if (action === "start") {
    if (existsSync(pidFile)) {
      try {
        const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
        if (!isNaN(pid)) {
          process.kill(pid, 0); // Throws if process is dead
          console.log(color(`❌ Ritsu daemon is already running (PID: ${pid}).`, "yellow"));
          return;
        }
      } catch {
        try { unlinkSync(pidFile); } catch { /* ignore */ }
      }
    }

    let cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "../cli.js");
    if (!existsSync(cliPath)) {
      cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "../cli.ts");
    }

    const logFd = openSync(logFile, "a");
    const child = spawn(process.execPath, [cliPath, "daemon", "--foreground"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      cwd: root,
      env: {
        ...process.env,
        RITSU_PROJECT_ROOT: root,
      }
    });

    child.unref();

    if (child.pid) {
      writeFileSync(pidFile, String(child.pid), "utf-8");
      console.log(color(`✅ Ritsu daemon started in background (PID: ${child.pid}).`, "green"));
    } else {
      console.error(color("❌ Failed to start Ritsu daemon in background.", "red"));
    }
    return;
  }

  if (action === "stop") {
    if (!existsSync(pidFile)) {
      console.log(color("ℹ Ritsu daemon is not running (no PID file).", "yellow"));
      return;
    }

    let pid: number;
    try {
      pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    } catch {
      console.error(color("❌ Failed to read PID file. Clearing stale file.", "red"));
      try { unlinkSync(pidFile); } catch { /* ignore */ }
      return;
    }

    if (isNaN(pid)) {
      console.error(color("❌ Invalid PID in file. Clearing stale file.", "red"));
      try { unlinkSync(pidFile); } catch { /* ignore */ }
      return;
    }

    try {
      console.log(color(`Stopping Ritsu daemon (PID: ${pid})...`, "dim"));
      process.kill(pid, "SIGTERM");

      let stopped = false;
      for (let i = 0; i < 50; i++) {
        try {
          process.kill(pid, 0);
          const { spawnSync } = require("node:child_process");
          spawnSync("sleep", ["0.1"]);
        } catch {
          stopped = true;
          break;
        }
      }

      if (!stopped) {
        console.log(color("⚠️ Daemon did not stop gracefully. Force killing...", "yellow"));
        try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
      }

      console.log(color("✅ Ritsu daemon stopped.", "green"));
    } catch (err: any) {
      console.log(color(`ℹ Daemon process was not found or already stopped: ${err.message}`, "dim"));
    } finally {
      try { unlinkSync(pidFile); } catch { /* ignore */ }
    }
    return;
  }

  if (action === "status") {
    if (existsSync(pidFile)) {
      try {
        const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
        if (!isNaN(pid)) {
          process.kill(pid, 0);
          console.log(color(`● Ritsu daemon is running (PID: ${pid}).`, "green"));
          return;
        }
      } catch {
        console.log(color("○ Ritsu daemon is stopped (stale PID file).", "yellow"));
        try { unlinkSync(pidFile); } catch { /* ignore */ }
        process.exit(1);
      }
    }
    console.log(color("○ Ritsu daemon is stopped.", "red"));
    process.exit(1);
  }

  console.error(color(`Unknown daemon command: ${action}. Use start, stop, or status.`, "red"));
  process.exit(1);
}
