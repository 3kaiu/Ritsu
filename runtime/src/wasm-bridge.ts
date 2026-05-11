/**
 * WASM 绑定层 — 桥接 Node.js 与 Rust WASM 核心模块
 *
 * 运行时检测 WASM 可用性：
 * - pkg/ 存在 → 加载 WASM，热路径走 Rust
 * - pkg/ 不存在 → 返回 null，handler 回退到纯 JS（ajv）
 *
 * 用户只需 npm install 即可使用（纯 JS 回退），
 * 安装 Rust 工具链 + npm run build:wasm 可获得 WASM 加速。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSharedDir, getPkgDir } from "./shared.js";

let _wasm: any = null;
let _wasmAvailable: boolean | null = null;

// 简易异步互斥锁 — 防止并发 loadWasm 导致重复初始化
let _loadMutex: Promise<void> = Promise.resolve();

async function loadWasm(): Promise<any | null> {
  if (_wasmAvailable !== null) return _wasm;

  // 串行化：等待前一个 loadWasm 完成
  let release: () => void = () => {};
  _loadMutex = _loadMutex.then(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  await _loadMutex;

  try {
    // double-check：可能在等待期间已被其他调用加载
    if (_wasmAvailable !== null) return _wasm;

    // 检查 WASM 包是否存在
    const wasmJsPath = resolve(getPkgDir(), "ritsu_core.js");
    if (!existsSync(wasmJsPath)) {
      _wasmAvailable = false;
      return null;
    }

    const wasmModule = await import(wasmJsPath);
    await wasmModule.default();
    _wasm = wasmModule;

    // 初始化 Schema
    const schemaPath = resolve(getSharedDir(), "ctx-event-schema.json");
    const schemaJson = readFileSync(schemaPath, "utf-8");
    const ok = _wasm.init_schema(schemaJson);
    if (!ok) {
      console.error("[ritsu] WASM Schema init failed, falling back to JS");
      _wasmAvailable = false;
      return null;
    }

    _wasmAvailable = true;
    return _wasm;
  } catch (e: any) {
    console.warn(`[ritsu] WASM load failed: ${e.message}, falling back to JS`);
    _wasmAvailable = false;
    return null;
  } finally {
    release();
  }
}

// ─── Event Validator (WASM) ─────────────────────────────────

export async function validateEventWasm(
  event: Record<string, unknown>,
): Promise<{
  valid: boolean;
  errors?: string[];
} | null> {
  const wasm = await loadWasm();
  if (!wasm) return null;

  const eventJson = JSON.stringify(event);
  const result = wasm.validate_event_structured(eventJson);
  return JSON.parse(result);
}

// ─── Ctx Index (WASM) ────────────────────────────────────────

export async function appendToIndexWasm(
  lineJson: string,
): Promise<number | null> {
  const wasm = await loadWasm();
  if (!wasm) return null;
  return wasm.append_to_index(lineJson);
}

export async function queryRecentWasm(
  limit: number,
): Promise<Record<string, unknown>[] | null> {
  const wasm = await loadWasm();
  if (!wasm) return null;
  return JSON.parse(wasm.query_recent(limit));
}

export async function queryLastIncompleteWasm(): Promise<Record<
  string,
  unknown
> | null> {
  const wasm = await loadWasm();
  if (!wasm) return null;
  return JSON.parse(wasm.query_last_incomplete());
}

export async function queryLastCompletedWasm(): Promise<Record<
  string,
  unknown
> | null> {
  const wasm = await loadWasm();
  if (!wasm) return null;
  return JSON.parse(wasm.query_last_completed());
}

export async function queryPendingApprovalsWasm(): Promise<
  Record<string, unknown>[] | null
> {
  const wasm = await loadWasm();
  if (!wasm) return null;
  return JSON.parse(wasm.query_pending_approvals());
}

/** 从 ctx 文件读取内容并构建 WASM 索引（首次查询时调用） */
export async function buildIndexFromCtxFile(
  ctxFilePath: string,
): Promise<number | null> {
  const wasm = await loadWasm();
  if (!wasm) return null;
  if (!existsSync(ctxFilePath)) return 0;
  const content = readFileSync(ctxFilePath, "utf-8").trim();
  if (!content) return 0;
  return wasm.build_index(content);
}

// ─── Correlation ID (WASM) ───────────────────────────────────

export async function nextCorrelationIdWasm(
  dateStr: string,
  baseSeq: number,
): Promise<string | null> {
  const wasm = await loadWasm();
  if (!wasm) return null;
  return wasm.next_correlation_id(dateStr, baseSeq);
}
