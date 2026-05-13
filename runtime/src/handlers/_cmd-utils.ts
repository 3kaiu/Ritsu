import { spawn } from "node:child_process";
import {
  DANGEROUS_ARGS,
  RESIDUAL_BLACKLIST,
  SHELL_META_REJECT,
  MAX_BUFFER_MB_HARD_LIMIT,
  MAX_TIMEOUT_MS_HARD_LIMIT,
} from "../shared.js";
import { getAllowedBinariesForProject } from "../shared.js";

type ParsedCommand = {
  binary: string;
  args: string[];
};

export function parseCommand(cmd: string): ParsedCommand | null {
  const tokens: string[] = [];
  let i = 0;
  const len = cmd.length;

  while (i < len) {
    while (i < len && /\s/.test(cmd[i])) i++;
    if (i >= len) break;

    let token = "";

    if (cmd[i] === '"') {
      i++;
      while (i < len && cmd[i] !== '"') {
        if (cmd[i] === "\\" && i + 1 < len) {
          i++;
          token += cmd[i];
        } else {
          token += cmd[i];
        }
        i++;
      }
      if (i < len) i++;
    } else if (cmd[i] === "'") {
      i++;
      while (i < len && cmd[i] !== "'") {
        token += cmd[i];
        i++;
      }
      if (i < len) i++;
    } else {
      while (i < len && !/\s/.test(cmd[i])) {
        token += cmd[i];
        i++;
      }
    }

    if (token.length > 0) tokens.push(token);
  }

  if (tokens.length === 0) return null;
  return { binary: tokens[0], args: tokens.slice(1) };
}

export function validateCommandSafety(command: string): { ok: boolean; error?: string } {
  const trimmedCmd = command.trim();

  for (const pattern of SHELL_META_REJECT) {
    if (pattern.test(trimmedCmd)) {
      return {
        ok: false,
        error:
          `shell metacharacter blocked: only single direct commands supported. Matched: ${pattern.source}`,
      };
    }
  }

  const parsed = parseCommand(trimmedCmd);
  if (!parsed) return { ok: false, error: "empty command after parsing" };

  if (!getAllowedBinariesForProject([]).has(parsed.binary)) {
    return {
      ok: false,
      error: `command blocked: '${parsed.binary}' is not in the allowed binaries list`,
    };
  }

  for (const pattern of DANGEROUS_ARGS) {
    if (pattern.test(trimmedCmd)) {
      return { ok: false, error: `dangerous argument blocked: ${pattern.source}` };
    }
  }

  for (const pattern of RESIDUAL_BLACKLIST) {
    if (pattern.test(trimmedCmd)) {
      return { ok: false, error: `dangerous command blocked: ${pattern.source}` };
    }
  }

  return { ok: true };
}

export async function runCmdWithCwd(
  parsed: ParsedCommand,
  cwd: string,
  maxLines = 200,
  timeoutMs = 30_000,
  maxBufferMb = 10,
): Promise<{ ok: boolean; output: string }> {
  const safeTimeout = Math.min(timeoutMs, MAX_TIMEOUT_MS_HARD_LIMIT);
  const safeMaxBuffer = Math.min(maxBufferMb, MAX_BUFFER_MB_HARD_LIMIT);

  return new Promise((resolvePromise) => {
    const child = spawn(parsed.binary, parsed.args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const maxBytes = safeMaxBuffer * 1024 * 1024;

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < maxBytes) stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < maxBytes) stderr += chunk.toString("utf-8");
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolvePromise({ ok: false, output: stdout || stderr || "timeout" });
    }, safeTimeout);

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      const raw = (code === 0 ? stdout : stderr || stdout).trim();
      const lines = raw.split("\n");
      const truncated = lines.length > maxLines;
      const output = truncated
        ? lines.slice(0, maxLines).join("\n") + "\n⚠️ 输出已截断"
        : raw;
      resolvePromise({ ok: code === 0, output });
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      resolvePromise({ ok: false, output: err.message });
    });
  });
}
