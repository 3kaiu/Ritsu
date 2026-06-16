/**
 * Agent Launcher MCP Tool
 *
 * Spawns AI coding agent subprocesses (Claude Code, Codex CLI)
 * for multi-agent orchestration. Bypasses ritsu_exec restrictions
 * because agent CLIs are not in the normal tool allowlist.
 *
 * Each launched agent gets:
 *   - A focused prompt with specific contract(s)
 *   - RITSU_TRACE_PARENT for span linking to the orchestrator trace
 *   - A unique agent_id for result tracking
 *
 * v8.2.0
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { safeExecSync } from "../shared.js";

import { getProjectRoot, textResult, structuredError, ts } from "./_utils.js";

// ─── Types ────────────────────────────────────────────────────

export interface AgentLaunchResult {
  agent_id: string;
  prompt: string;
  agent_type: string;
  ok: boolean;
  output: string;
  exit_code: number | null;
  duration_ms: number;
  started_at: string;
  trace_parent?: string;
}

export interface AgentLaunchParams {
  prompt: string;
  agent_type?: "claude" | "codex";
  timeout_ms?: number;
  max_output_lines?: number;
  trace_id?: string;
  span_id?: string;
  cwd?: string;
}

const AGENT_CLI_NAMES: Record<string, string[]> = {
  claude: ["claude", "claude-code", "npx"],
  codex: ["codex", "codex-cli"],
};

function resolveAgentBinary(agentType: string): string | null {
  const candidates = AGENT_CLI_NAMES[agentType] ?? AGENT_CLI_NAMES.claude;
  for (const bin of candidates) {
    try {
      // Quick check if binary exists in PATH
      safeExecSync("which", [bin], { stdio: "ignore" });
      return bin;
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Agent Launcher ───────────────────────────────────────────

/**
 * Launch an AI coding agent subprocess.
 *
 * This is a direct spawn (not through ritsu_exec) to avoid the
 * restrictive binary allowlist that would block claude/codex.
 *
 * The agent receives:
 *   - The prompt via -p / --prompt flag
 *   - RITSU_TRACE_PARENT for trace linking
 *   - Project root as working directory
 */
export async function launchAgent(
  params: AgentLaunchParams,
): Promise<AgentLaunchResult> {
  const startTime = Date.now();
  const agentId = `agent-${randomBytes(4).toString("hex")}`;
  const agentType = params.agent_type ?? "claude";
  const timeoutMs = Math.min(params.timeout_ms ?? 300_000, 600_000); // max 10min
  const maxOutputLines = params.max_output_lines ?? 200;
  const projectRoot = params.cwd ?? getProjectRoot();

  // Resolve which binary to use
  const binary = resolveAgentBinary(agentType);
  if (!binary) {
    return {
      agent_id: agentId,
      prompt: params.prompt,
      agent_type: agentType,
      ok: false,
      output: `❌ ${agentType} CLI not found in PATH. Install it first.`,
      exit_code: -1,
      duration_ms: 0,
      started_at: ts(),
    };
  }

  // Build args based on agent type
  const args: string[] = [];

  if (binary === "npx") {
    args.push("claude-code", "-p", params.prompt);
  } else {
    args.push("-p", params.prompt);
  }

  // Build env with trace propagation
  const env: Record<string, string | undefined> = { ...process.env as Record<string, string | undefined> };
  if (params.trace_id && params.span_id) {
    env.RITSU_TRACE_PARENT = `${params.trace_id}:${agentId}`;
  }

  return new Promise((resolvePromise) => {
    const child = spawn(binary, args, {
      cwd: projectRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const maxBytes = 10 * 1024 * 1024; // 10MB buffer

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < maxBytes) stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < maxBytes) stderr += chunk.toString("utf-8");
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      const duration = Date.now() - startTime;
      resolvePromise({
        agent_id: agentId,
        prompt: params.prompt,
        agent_type: agentType,
        ok: false,
        output: truncateLines(stdout || stderr || "timeout", maxOutputLines),
        exit_code: null,
        duration_ms: duration,
        started_at: ts(),
        trace_parent: params.trace_id ? `${params.trace_id}:${agentId}` : undefined,
      });
    }, timeoutMs);

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;
      const raw = code === 0 ? stdout : stderr || stdout;
      resolvePromise({
        agent_id: agentId,
        prompt: params.prompt,
        agent_type: agentType,
        ok: code === 0,
        output: truncateLines(raw, maxOutputLines),
        exit_code: code,
        duration_ms: duration,
        started_at: ts(),
        trace_parent: params.trace_id ? `${params.trace_id}:${agentId}` : undefined,
      });
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;
      resolvePromise({
        agent_id: agentId,
        prompt: params.prompt,
        agent_type: agentType,
        ok: false,
        output: `Failed to launch ${binary}: ${err.message}`,
        exit_code: -1,
        duration_ms: duration,
        started_at: ts(),
        trace_parent: params.trace_id ? `${params.trace_id}:${agentId}` : undefined,
      });
    });
  });
}

function truncateLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + `\n⚠️ Output truncated (${lines.length - maxLines} more lines)`;
}

// ─── MCP Tool Handler ─────────────────────────────────────────

export async function ritsu_launch_agent(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const prompt = String(params.prompt ?? "");
  if (!prompt) {
    return structuredError("ValidationError", "PROMPT_REQUIRED", "prompt is required");
  }

  const result = await launchAgent({
    prompt,
    agent_type: String(params.agent_type ?? "claude") as "claude" | "codex",
    timeout_ms: Number(params.timeout_ms ?? 300_000),
    max_output_lines: Number(params.max_output_lines ?? 200),
    trace_id: params.trace_id ? String(params.trace_id) : undefined,
    span_id: params.span_id ? String(params.span_id) : undefined,
  });

  return textResult(JSON.stringify(result));
}
