import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot, errorResult, textResult } from "./_utils.js";
import { parseCommand, runCmdWithCwd, validateCommandSafety } from "./_cmd-utils.js";

export async function ritsu_sandbox_exec(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const cid = String(params.correlation_id ?? "").trim();
  const command = String(params.command ?? "").trim();
  const maxLines = Number(params.max_output_lines ?? 200);
  const timeoutMs = Number(params.timeout_ms ?? 30_000);
  const maxBufferMb = Number(params.max_buffer_mb ?? 10);

  if (!cid) return errorResult("correlation_id is required");
  if (!command) return errorResult("command is required");

  const sandboxPath = resolve(root, ".ritsu", "temp", cid);
  if (!existsSync(sandboxPath)) {
    return errorResult(`sandbox not found: ${sandboxPath}. Run ritsu_sandbox_prepare first.`);
  }

  const safety = validateCommandSafety(command);
  if (!safety.ok) return errorResult(safety.error ?? "command blocked");

  const parsed = parseCommand(command);
  if (!parsed) return errorResult("empty command after parsing");

  const r = await runCmdWithCwd(parsed, sandboxPath, maxLines, timeoutMs, maxBufferMb);
  return textResult(JSON.stringify({ ok: r.ok, output: r.output, cwd: sandboxPath }));
}
