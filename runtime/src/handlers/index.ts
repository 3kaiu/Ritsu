/**
 * 工具 Handler 注册表
 *
 * 产品面已经收敛为 intake / deliver / assure。
 * 这里不再维护“8 个工具”之类的历史描述，而以实际注册表为准。
 *
 * 可以大致分成三类：
 * - stable: ctx / artifact / exec / diff / quality gates
 * - conditional: contract validate
 * - advanced: sandbox / semantic / kg / ts
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ritsu_emit_event } from "./emit-event.js";
import { ritsu_read_ctx } from "./read-ctx.js";
import { ritsu_read_agents } from "./read-agents.js";
import { ritsu_contract_validate } from "./contract-validate.js";
import { ritsu_build_kg } from "./kg-build.js";
import { ritsu_query_kg } from "./kg-query.js";
import { ritsu_env_probe } from "./env-probe.js";
import { ritsu_sandbox_prepare } from "./sandbox-prepare.js";
import { ritsu_sandbox_exec } from "./sandbox-exec.js";
import { ritsu_sandbox_cleanup } from "./sandbox-cleanup.js";
import { ritsu_ts_check } from "./ts-check.js";
import { ritsu_ts_symbol_query } from "./ts-symbol-query.js";
import { ritsu_semantic_index_build } from "./semantic-index-build.js";
import { ritsu_semantic_search } from "./semantic-search.js";
import { ritsu_semantic_graph_rerank } from "./semantic-graph-rerank.js";
import { ritsu_write_artifact } from "./write-artifact.js";
import { ritsu_list_artifacts } from "./list-artifacts.js";
import { ritsu_exec } from "./exec.js";
import { ritsu_get_changed_files } from "./get-changed-files.js";
import { ritsu_get_diff } from "./get-diff.js";
import { ritsu_run_quality_gates } from "./run-quality-gates.js";

// ─── Handler Registry ────────────────────────────────────────

export const registerHandlers: Record<
  string,
  (params: Record<string, unknown>) => Promise<CallToolResult>
> = {
  ritsu_emit_event,
  ritsu_read_ctx,
  ritsu_read_agents,
  ritsu_contract_validate,
  ritsu_build_kg,
  ritsu_query_kg,
  ritsu_env_probe,
  ritsu_sandbox_prepare,
  ritsu_sandbox_exec,
  ritsu_sandbox_cleanup,
  ritsu_ts_check,
  ritsu_ts_symbol_query,
  ritsu_semantic_index_build,
  ritsu_semantic_search,
  ritsu_semantic_graph_rerank,
  ritsu_write_artifact,
  ritsu_list_artifacts,
  ritsu_exec,
  ritsu_get_changed_files,
  ritsu_get_diff,
  ritsu_run_quality_gates,
};
