/**
 * 工具 Handler 注册表 v6.1.0
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ritsu_emit_event } from "./emit-event.js";
import { ritsu_read_ctx } from "./read-ctx.js";
import { ritsu_read_agents } from "./read-agents.js";
import { ritsu_write_artifact } from "./write-artifact.js";
import { ritsu_patch_artifact } from "./patch-artifact.js";
import { ritsu_list_artifacts } from "./list-artifacts.js";
import { ritsu_exec } from "./exec.js";
import { ritsu_get_changed_files } from "./get-changed-files.js";
import { ritsu_get_diff } from "./get-diff.js";
import { ritsu_run_quality_gates } from "./run-quality-gates.js";
import {
  ritsu_read_preferences,
  ritsu_write_preference,
} from "./preferences.js";
import { ritsu_open_span } from "./open-span.js";
import { ritsu_close_span } from "./close-span.js";
import { ritsu_join_trace } from "./join-trace.js";
import { ritsu_diff_chunks } from "./diff-chunks.js";
import { ritsu_init_trust_key } from "./init-trust-key.js";
import { ritsu_claim_task, ritsu_list_pending_tasks } from "./task-protocol.js";
import { ritsu_verify_trace } from "./verify-trace.js";
import { ritsu_claim_file, ritsu_release_file, ritsu_list_leases } from "./file-lease.js";

// ─── Handler Registry ────────────────────────────────────────

export const registerHandlers: Record<
  string,
  (params: Record<string, unknown>) => Promise<CallToolResult>
> = {
  ritsu_emit_event,
  ritsu_read_ctx,
  ritsu_read_agents,
  ritsu_write_artifact,
  ritsu_patch_artifact,
  ritsu_list_artifacts,
  ritsu_exec,
  ritsu_get_changed_files,
  ritsu_get_diff,
  ritsu_run_quality_gates,
  ritsu_read_preferences,
  ritsu_write_preference,
  ritsu_open_span,
  ritsu_close_span,
  ritsu_join_trace,
  ritsu_diff_chunks,
  ritsu_init_trust_key,
  ritsu_claim_task,
  ritsu_list_pending_tasks,
  ritsu_verify_trace,
  ritsu_claim_file,
  ritsu_release_file,
  ritsu_list_leases,
};
