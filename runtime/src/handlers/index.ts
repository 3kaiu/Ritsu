/**
 * 工具 Handler 注册表 (SDK 模式)
 *
 * MCP Server = 纯 SDK，只提供结构化 I/O 原语。
 * SKILL.md = 程序，AI 是 CPU，按需调用这些系统调用。
 *
 * 6 个工具（各 handler 实现在独立文件中）：
 *   ritsu_emit_event     — 事件写入 + Schema 校验（WASM 加速）
 *   ritsu_read_ctx       — ctx 索引查询（WASM 加速）
 *   ritsu_write_artifact — 产物写入 + 占位符拦截
 *   ritsu_list_artifacts — 产物列表查询
 *   ritsu_exec           — 通用命令执行（带截断/超时/安全边界）
 *   ritsu_validate       — 独立 Schema 校验（纯 WASM）
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ritsu_emit_event } from "./emit-event.js";
import { ritsu_read_ctx } from "./read-ctx.js";
import { ritsu_write_artifact } from "./write-artifact.js";
import { ritsu_list_artifacts } from "./list-artifacts.js";
import { ritsu_exec } from "./exec.js";
import { ritsu_validate } from "./validate.js";

// ─── Handler Registry ────────────────────────────────────────

export const registerHandlers: Record<
  string,
  (params: Record<string, unknown>) => Promise<CallToolResult>
> = {
  ritsu_emit_event,
  ritsu_read_ctx,
  ritsu_write_artifact,
  ritsu_list_artifacts,
  ritsu_exec,
  ritsu_validate,
};
