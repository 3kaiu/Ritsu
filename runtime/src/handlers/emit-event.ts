import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  appendEvent,
  syncLineCountFromCtxFile,
  generateCorrelationId,
} from "../ctx-store.js";
import { validateEvent as validateEventJs } from "../event-validator.js";
import { validateEventWasm, appendToIndexWasm } from "../wasm-bridge.js";
import { getProjectRoot, ts, textResult, errorResult } from "./_utils.js";

// WASM 索引是否已初始化（进程级单例）
let _wasmIndexBuilt = false;
let _wasmIndexMonth = "";

// 简易异步互斥锁 — 防止并发 ensureWasmIndex 导致重复构建
let _indexMutex: Promise<void> = Promise.resolve();

export async function ensureWasmIndex(root: string): Promise<void> {
  const { getCtxFilePath, resetLineCount } = await import("../ctx-store.js");
  const { buildIndexFromCtxFile } = await import("../wasm-bridge.js");

  const currentMonth = new Date().toISOString().slice(0, 7);
  if (_wasmIndexBuilt && _wasmIndexMonth === currentMonth) return;

  let release: () => void = () => {};
  _indexMutex = _indexMutex.then(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  await _indexMutex;

  try {
    if (_wasmIndexBuilt && _wasmIndexMonth === currentMonth) return;

    const ctxPath = getCtxFilePath(root);
    const count = await buildIndexFromCtxFile(ctxPath);
    if (count !== null) {
      resetLineCount(count);
      _wasmIndexBuilt = true;
      _wasmIndexMonth = currentMonth;
    }
  } finally {
    release();
  }
}

export async function ritsu_emit_event(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const eventType = String(params.event_type ?? "");
  let correlationId = params.correlation_id
    ? String(params.correlation_id)
    : "";
  const step = params.step ? String(params.step) : undefined;

  if (!eventType) return errorResult("event_type is required");

  const root = getProjectRoot();

  // correlation_id: 若调用方提供则使用，否则在文件锁内原子生成（generateCorrelationId 已加锁）
  if (!correlationId) {
    correlationId = generateCorrelationId(root);
  }

  // 构造事件对象 — step/artifact/progress 仅在有值时设置，避免 null 违反 Schema pattern
  const event: Record<string, unknown> = {
    ts: ts(),
    correlation_id: correlationId,
    skill: String(params.skill ?? "unknown"),
    domain: String(params.domain ?? "unknown"),
    status: eventType,
  };

  if (step) event.step = step;
  if (params.artifact !== undefined) {
    event.artifact = params.artifact;
  } else {
    event.artifact = null;
  }
  if (params.progress !== undefined) {
    event.progress = params.progress;
  } else {
    event.progress = null;
  }
  if (params.error) event.error = String(params.error);
  if (params.approval) event.approval = params.approval;
  if (params.artifact_meta) event.artifact_meta = params.artifact_meta;
  if (params.violation) event.violation = params.violation;
  if (params.redirect) event.redirect = String(params.redirect);
  if (params.transition) event.transition = params.transition;
  if (params.duration_ms) event.duration_ms = Number(params.duration_ms);

  // Schema 校验 — WASM 优先，JS 回退
  const wasmResult = await validateEventWasm(event);
  const validation = wasmResult ?? validateEventJs(event);
  if (!validation.valid) {
    return errorResult(
      `event validation failed: ${validation.errors?.join(", ")}`,
    );
  }

  const result = appendEvent(root, event);

  // WASM 索引增量更新 — 失败时从文件重算行数，保持 JS/WASM 一致
  try {
    await appendToIndexWasm(JSON.stringify(event));
  } catch (e: any) {
    console.warn(`[ritsu] WASM index append failed: ${e.message}`);
    _wasmIndexBuilt = false;
    syncLineCountFromCtxFile(root);
  }

  return textResult(
    JSON.stringify({
      written: true,
      line_count: result.lineCount,
      ts: event.ts,
      correlation_id: event.correlation_id,
    }),
  );
}
