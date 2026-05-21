import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { detectProjectRoot } from "../project-root.js";
import type { RitsuToolError } from "../shared.js";

export function getProjectRoot(): string {
  return detectProjectRoot();
}

export function ts(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(msg: string): CallToolResult {
  return { content: [{ type: "text", text: `❌ ${msg}` }], isError: true };
}

// ─── 结构化错误返回 ───────────────────────────────────────────

export function structuredError(
  type: RitsuToolError["error"]["type"],
  code: string,
  message: string,
  opts?: {
    violations?: RitsuToolError["error"]["violations"];
    recovery_hint?: string;
  },
): CallToolResult {
  const result: RitsuToolError = {
    error: { type, code, message },
  };
  if (opts?.violations) result.error.violations = opts.violations;
  if (opts?.recovery_hint) result.error.recovery_hint = opts.recovery_hint;
  return { content: [{ type: "text", text: JSON.stringify(result) }], isError: true };
}

export function jsonErrorResult(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], isError: true };
}

/** 非致命警告 — 返回数据但附带警告信息，调用方可区分"真的没有数据"和"出错了" */
export function warnResult(
  data: Record<string, unknown>,
  warning: string,
): CallToolResult {
  return textResult(JSON.stringify({ ...data, _warning: warning }));
}
