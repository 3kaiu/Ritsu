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
import {
  parseCommand,
  runCmdWithCwd,
  detectStackFingerprints,
} from "./_cmd-utils.js";


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

  const r = await runCmdWithCwd(parsed, root, maxLines, timeoutMs, maxBufferMb);
  return textResult(JSON.stringify({ ok: r.ok, output: r.output }));
}
