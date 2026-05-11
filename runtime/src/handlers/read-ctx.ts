import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  readRecentEntries,
  readLastCompleted,
  readLastIncomplete,
} from "../ctx-store.js";
import {
  queryLastIncompleteWasm,
  queryLastCompletedWasm,
  queryPendingApprovalsWasm,
  queryRecentWasm,
} from "../wasm-bridge.js";
import { getProjectRoot, textResult } from "./_utils.js";
import { ensureWasmIndex } from "./emit-event.js";

export async function ritsu_read_ctx(): Promise<CallToolResult> {
  const root = getProjectRoot();

  // 首次查询时构建 WASM 索引
  await ensureWasmIndex(root);

  // WASM 加速路径
  const wasmIncomplete = await queryLastIncompleteWasm();
  const wasmCompleted = await queryLastCompletedWasm();
  const wasmPending = await queryPendingApprovalsWasm();
  const wasmRecent = await queryRecentWasm(10);

  if (
    wasmIncomplete !== null &&
    wasmCompleted !== null &&
    wasmPending !== null &&
    wasmRecent !== null
  ) {
    return textResult(
      JSON.stringify({
        last_incomplete: wasmIncomplete,
        last_completed: wasmCompleted,
        recent_entries: wasmRecent,
        pending_approvals: wasmPending,
      }),
    );
  }

  // 纯 JS 回退
  const lastIncomplete = readLastIncomplete(root);
  const lastCompleted = readLastCompleted(root);
  const recentEntries = readRecentEntries(root, 10);
  const pendingApprovals = recentEntries.filter(
    (e) => e.status === "approval_required",
  );

  return textResult(
    JSON.stringify({
      last_incomplete: lastIncomplete,
      last_completed: lastCompleted,
      recent_entries: recentEntries,
      pending_approvals: pendingApprovals,
    }),
  );
}
