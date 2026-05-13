import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import {
  getAllowedBinariesForProject,
  DANGEROUS_ARGS,
  RESIDUAL_BLACKLIST,
  SHELL_META_REJECT,
  MAX_BUFFER_MB_HARD_LIMIT,
  MAX_TIMEOUT_MS_HARD_LIMIT,
} from "../shared.js";
import {
  getProjectRoot,
  textResult,
  errorResult,
} from "./_utils.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ─── 命令解析器 ──────────────────────────────────────────────
// 将命令字符串解析为 binary + args，支持引号和转义。
// 不经过 shell 解释，从根本上消除命令注入风险。

interface ParsedCommand {
  binary: string;
  args: string[];
}

function parseCommand(cmd: string): ParsedCommand | null {
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

// ─── 直接执行模式 ────────────────────────────────────────────

async function runCmd(
  parsed: ParsedCommand,
  maxLines = 200,
  timeoutMs = 30_000,
  maxBufferMb = 10,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(parsed.binary, parsed.args, {
      cwd: getProjectRoot(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const maxBytes = maxBufferMb * 1024 * 1024;

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < maxBytes) stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < maxBytes) stderr += chunk.toString("utf-8");
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, output: stdout || stderr || "timeout" });
    }, timeoutMs);

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      const raw = (code === 0 ? stdout : stderr || stdout).trim();
      const lines = raw.split("\n");
      const truncated = lines.length > maxLines;
      const output = truncated
        ? lines.slice(0, maxLines).join("\n") + "\n⚠️ 输出已截断"
        : raw;
      resolve({ ok: code === 0, output });
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({ ok: false, output: err.message });
    });
  });
}

function detectStackFingerprints(root: string): string[] {
  const fingerprints: string[] = [];
  if (existsSync(join(root, "package.json"))) fingerprints.push("nodejs");
  if (existsSync(join(root, "go.mod"))) fingerprints.push("go");
  if (existsSync(join(root, "requirements.txt")) || existsSync(join(root, "pyproject.toml"))) fingerprints.push("python");
  if (existsSync(join(root, "pubspec.yaml"))) fingerprints.push("flutter");
  if (existsSync(join(root, "pom.xml")) || existsSync(join(root, "build.gradle"))) fingerprints.push("java");
  if (existsSync(join(root, "Cargo.toml"))) fingerprints.push("rust");
  return fingerprints;
}

export async function ritsu_exec(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const command = String(params.command ?? "");
  const maxLines = Number(params.max_output_lines ?? 200);
  const timeoutMs = Math.min(
    Number(params.timeout_ms ?? 30_000),
    MAX_TIMEOUT_MS_HARD_LIMIT,
  );
  const maxBufferMb = Math.min(
    Number(params.max_buffer_mb ?? 10),
    MAX_BUFFER_MB_HARD_LIMIT,
  );

  if (!command) return errorResult("command is required");

  const trimmedCmd = command.trim();

  // 第零层：Shell 元字符拦截 — 拒绝管道/重定向/子shell/换行等
  // ritsu_exec 只支持单命令直接执行，需要管道时请多次调用
  for (const pattern of SHELL_META_REJECT) {
    if (pattern.test(trimmedCmd)) {
      return errorResult(
        `shell metacharacter blocked: ritsu_exec only supports single direct commands (no pipes/redirects/subshells). ` +
          `Matched: ${pattern.source}. Chain multiple ritsu_exec calls instead.`,
      );
    }
  }

  // 解析命令为 binary + args（不经 shell 解释）
  const parsed = parseCommand(trimmedCmd);
  if (!parsed) return errorResult("empty command after parsing");

  // 第一层：动态白名单校验 — 只允许安全二进制与当前技术栈相关的工具
  const root = getProjectRoot();
  const fingerprints = detectStackFingerprints(root);
  const allowedBinaries = getAllowedBinariesForProject(fingerprints);

  if (!allowedBinaries.has(parsed.binary)) {
    return errorResult(
      `command blocked: '${parsed.binary}' is not in the allowed binaries list for this project context (fingerprints: ${fingerprints.join(", ") || "none"}).`,
    );
  }

  // 第二层：危险参数黑名单 — 拦截白名单二进制的代码注入/数据外泄用法
  for (const pattern of DANGEROUS_ARGS) {
    if (pattern.test(trimmedCmd)) {
      return errorResult(
        `dangerous argument blocked by safety boundary: ${pattern.source}`,
      );
    }
  }

  // 第三层：残余黑名单 — 拦截允许的二进制中的危险用法
  for (const pattern of RESIDUAL_BLACKLIST) {
    if (pattern.test(trimmedCmd)) {
      return errorResult(
        `dangerous command blocked by safety boundary: ${pattern.source}`,
      );
    }
  }

  const r = await runCmd(parsed, maxLines, timeoutMs, maxBufferMb);
  return textResult(JSON.stringify({ ok: r.ok, output: r.output }));
}
