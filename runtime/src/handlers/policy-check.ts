import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { textResult, errorResult } from "./_utils.js";
import { evaluatePolicies } from "../policy/index.js";
import type { PolicyCheckContext } from "../policy/types.js";

function isPolicyAction(value: string): value is PolicyCheckContext["action"] {
  return value === "write_artifact" || value === "emit_event" || value === "commit_diff";
}

function parsePolicyContext(value: unknown): PolicyCheckContext["context"] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const inScopeFiles = Array.isArray(raw.in_scope_files)
    ? raw.in_scope_files.filter((file): file is string => typeof file === "string")
    : undefined;
  const scanFiles = Array.isArray(raw.scan_files)
    ? raw.scan_files.filter((file): file is string => typeof file === "string")
    : undefined;

  return {
    skill: typeof raw.skill === "string" ? raw.skill : undefined,
    correlation_id:
      typeof raw.correlation_id === "string" ? raw.correlation_id : undefined,
    in_scope_files: inScopeFiles,
    scan_files: scanFiles,
  };
}

export async function ritsu_policy_check(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const action = String(params.action ?? "");

  if (!isPolicyAction(action)) {
    return errorResult("action must be write_artifact, emit_event, or commit_diff");
  }

  const ctx: PolicyCheckContext = {
    action,
    target: params.target ? String(params.target) : undefined,
    content: params.content ? String(params.content) : undefined,
    context: parsePolicyContext(params.context),
  };

  const result = evaluatePolicies(ctx);

  return textResult(JSON.stringify(result, null, 2));
}
