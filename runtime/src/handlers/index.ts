/**
 * 工具 Handler 注册表 v5.0.0
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ritsu_emit_event } from "./emit-event.js";
import { ritsu_read_ctx } from "./read-ctx.js";
import { ritsu_read_agents } from "./read-agents.js";
import { ritsu_contract_validate } from "./contract-validate.js";
import { ritsu_build_kg } from "./kg-build.js";
import { ritsu_query_kg } from "./kg-query.js";
import { ritsu_ts_check } from "./ts-check.js";
import {
  ritsu_semantic_search,
  ritsu_semantic_index_build,
} from "./semantic-search.js";
import { ritsu_write_artifact } from "./write-artifact.js";
import { ritsu_list_artifacts } from "./list-artifacts.js";
import { ritsu_exec } from "./exec.js";
import { ritsu_get_changed_files } from "./get-changed-files.js";
import { ritsu_get_diff } from "./get-diff.js";
import { ritsu_run_quality_gates } from "./run-quality-gates.js";
import {
  ritsu_read_preferences,
  ritsu_write_preference,
} from "./preferences.js";

// ─── Handler Registry ────────────────────────────────────────

export const registerHandlers: Record<
  string,
  (params: any) => Promise<CallToolResult>
> = {
  ritsu_emit_event,
  ritsu_read_ctx,
  ritsu_read_agents,
  ritsu_contract_validate,
  ritsu_kg_query: async (params) => {
    if (params.action === "update") return ritsu_build_kg(params);
    return ritsu_query_kg(params);
  },
  ritsu_ts_check,
  ritsu_semantic_search,
  ritsu_semantic_index_build,
  ritsu_write_artifact,
  ritsu_list_artifacts,
  ritsu_exec,
  ritsu_get_changed_files,
  ritsu_get_diff,
  ritsu_run_quality_gates,
  ritsu_read_preferences,
  ritsu_write_preference,
};
