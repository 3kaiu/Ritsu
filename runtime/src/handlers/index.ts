/**
 * 工具 Handler 注册表 (SDK + 业务工具模式)
 *
 * MCP Server = SDK 原语 + 高频业务封装。
 * SKILL.md = 程序，AI 是 CPU，按需调用这些系统调用。
 *
 * 8 个工具（各 handler 实现在独立文件中）：
 *   ritsu_emit_event       — 事件写入 + Schema 校验
 *   ritsu_read_ctx         — ctx 索引查询
 *   ritsu_write_artifact   — 产物写入 + 占位符拦截
 *   ritsu_list_artifacts   — 产物列表查询
 *   ritsu_exec             — 通用命令执行（带截断/超时/安全边界）
 *   ritsu_get_changed_files — 变更文件列表 + 自动领域推断
 *   ritsu_get_diff         — 结构化 diff 分析 + 新增标识符提取
 *   ritsu_run_quality_gates — Lint/Test 执行 + 结构化结果
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
  ritsu_write_artifact,
  ritsu_list_artifacts,
  ritsu_exec,
  ritsu_get_changed_files,
  ritsu_get_diff,
  ritsu_run_quality_gates,
};
