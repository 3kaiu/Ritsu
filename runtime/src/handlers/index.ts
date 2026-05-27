/**
 * 工具 Handler 注册表 v8.6.0 — cleaned
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ritsu_emit_event } from "./emit-event.js";
import { ritsu_read_ctx, ritsu_verify_trace } from "./ctx-controller.js";
import { ritsu_read_agents } from "./read-agents.js";
import { ritsu_write_artifact } from "./artifact-manager.js";
import { ritsu_list_artifacts } from "./list-artifacts.js";
import { ritsu_exec } from "./exec.js";
import { ritsu_get_changed_files, ritsu_inspect_git_changes } from "./diff-analyzer.js";
import { ritsu_run_quality_gates } from "./run-quality-gates.js";
import { ritsu_read_preferences, ritsu_write_preference } from "./preferences.js";
import { ritsu_span_lifecycle, ritsu_join_trace } from "./span-orchestrator.js";
import { ritsu_init_trust_key } from "./init-trust-key.js";
import { ritsu_sync_openspec_contracts } from "./sync-openspec-contracts.js";
import { ritsu_bootstrap_ecosystem } from "./bootstrap-ecosystem.js";
import { ritsu_preflight } from "./preflight.js";
import { ritsu_learn } from "./learn.js";
import { ritsu_agent_status } from "./agent-status.js";
import { ritsu_coordination } from "./coordination.js";
import { ritsu_write_file } from "./write-file.js";
import { ritsu_launch_agent } from "./launch-agent.js";
import { ritsu_dispatch_task } from "./multi-agent-dispatch.js";

// ─── Handler Registry ───────

export const registerHandlers: Record<
  string,
  (params: Record<string, unknown>) => Promise<CallToolResult>
> = {
  ritsu_emit_event,
  ritsu_read_ctx,
  ritsu_read_agents,
  ritsu_write_artifact,
  ritsu_list_artifacts,
  ritsu_exec,
  ritsu_get_changed_files,
  ritsu_run_quality_gates,
  ritsu_read_preferences,
  ritsu_write_preference,
  ritsu_join_trace,
  ritsu_init_trust_key,
  ritsu_verify_trace,
  ritsu_sync_openspec_contracts,
  ritsu_bootstrap_ecosystem,
  ritsu_preflight,
  ritsu_learn,
  ritsu_agent_status,
  ritsu_coordination,
  ritsu_inspect_git_changes,
  ritsu_span_lifecycle,
  write_file: ritsu_write_file,
  ritsu_launch_agent,
  ritsu_dispatch_task,
};
