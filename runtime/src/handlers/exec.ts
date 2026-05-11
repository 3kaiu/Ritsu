import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import {
  ALLOWED_BINARIES,
  DANGEROUS_ARGS,
  RESIDUAL_BLACKLIST,
  MAX_BUFFER_MB_HARD_LIMIT,
  MAX_TIMEOUT_MS_HARD_LIMIT,
} from "../shared.js";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";

async function runCmd(
  cmd: string,
  maxLines = 200,
  timeoutMs = 30_000,
  maxBufferMb = 10,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", cmd], {
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

  // 安全边界：白名单 + 危险参数黑名单 + 残余黑名单
  // 第一层：提取命令二进制名，只允许安全子集
  const trimmedCmd = command.trim();

  // 提取命令链中所有二进制名（处理管道、&&、; 等分隔符）
  const cmdParts = trimmedCmd.split(/\||&&|;|\|\||&/).map((s) => s.trim());
  for (const part of cmdParts) {
    // 去除前导环境变量赋值 (KEY=val cmd ...)
    const stripped = part.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s*/, "").trim();
    const binary = stripped.split(/\s+/)[0];
    if (!binary) continue;
    if (!ALLOWED_BINARIES.has(binary)) {
      return errorResult(
        `command blocked: '${binary}' is not in the allowed binaries list`,
      );
    }
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

  const r = await runCmd(command, maxLines, timeoutMs, maxBufferMb);
  return textResult(JSON.stringify({ ok: r.ok, output: r.output }));
}
