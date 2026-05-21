import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
// node:child_process import removed (unused)
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
  structuredError,
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

  if (!command) return structuredError("ValidationError", "CMD_REQUIRED", "command is required");

  const trimmedCmd = command.trim();

  // 第零层：Shell 元字符拦截 — 拒绝管道/重定向/子shell/换行等
  // ritsu_exec 只支持单命令直接执行，需要管道时请多次调用
  for (const pattern of SHELL_META_REJECT) {
    if (pattern.test(trimmedCmd)) {
      return structuredError("ValidationError", "SHELL_META", `shell metacharacter blocked: ${pattern.source} — ritsu_exec only supports single direct commands. Chain multiple calls instead.`);
    }
  }

  // 解析命令为 binary + args（不经 shell 解释）
  const parsed = parseCommand(trimmedCmd);
  if (!parsed) return structuredError("ValidationError", "CMD_EMPTY", "empty command after parsing");

  // 第一层：动态白名单校验 — 只允许安全二进制与当前技术栈相关的工具
  const root = getProjectRoot();
  const fingerprints = detectStackFingerprints(root);
  const allowedBinaries = getAllowedBinariesForProject(fingerprints);

  if (!allowedBinaries.has(parsed.binary)) {
    return structuredError("ExecutionError", "CMD_NOT_ALLOWED", `command blocked: '${parsed.binary}' is not in the allowed binaries list`);
  }

  // 第二层：危险参数黑名单 — 拦截白名单二进制的代码注入/数据外泄用法
  for (const pattern of DANGEROUS_ARGS) {
    if (pattern.test(trimmedCmd)) {
      return structuredError("ExecutionError", "DANGEROUS_ARG", `dangerous argument blocked: ${pattern.source}`);
    }
  }

  // 第三层：残余黑名单 — 拦截允许的二进制中的危险用法
  for (const pattern of RESIDUAL_BLACKLIST) {
    if (pattern.test(trimmedCmd)) {
      return structuredError("ExecutionError", "RESIDUAL_BLOCK", `dangerous command blocked: ${pattern.source}`);
    }
  }

  const r = await runCmdWithCwd(parsed, root, maxLines, timeoutMs, maxBufferMb);
  return textResult(JSON.stringify({ ok: r.ok, output: r.output }));
}
