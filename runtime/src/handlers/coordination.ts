/**
 * Unified Coordination — 文件锁定 + 任务分配
 *
 * 合并 ritsu_file_lease 和 ritsu_task_coordination 为一个 action 驱动的工具,
 * 减少 LLM 的 MCP 工具选择负担。
 *
 * action: claim_file | release_file | list_files | claim_task | list_tasks
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ritsu_file_lease } from "./file-lease.js";
import { ritsu_task_coordination } from "./task-protocol.js";
import { errorResult } from "./_utils.js";

export async function ritsu_coordination(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const action = String(params.action ?? "");

  switch (action) {
    case "claim_file":
    case "release_file":
    case "list_files":
      return ritsu_file_lease({
        action: action.replace("_file", ""),
        path: params.path,
        span_id: params.span_id,
        ttl_ms: params.ttl_ms,
      });

    case "claim_task":
    case "list_tasks":
      return ritsu_task_coordination({
        action: action.replace("_task", ""),
        span_id: params.span_id,
        agent_id: params.agent_id,
      });

    default:
      return errorResult(
        `Invalid coordination action: "${action}". Valid: claim_file, release_file, list_files, claim_task, list_tasks`,
      );
  }
}
