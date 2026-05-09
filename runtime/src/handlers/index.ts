/**
 * 工具 Handler 注册表 (SDK 模式)
 *
 * MCP Server = 纯 SDK，只提供结构化 I/O 原语。
 * SKILL.md = 程序，AI 是 CPU，按需调用这些系统调用。
 *
 * 6 个工具：
 *   ritsu_emit_event     — 事件写入 + Schema 校验（WASM 加速）
 *   ritsu_read_ctx       — ctx 索引查询（WASM 加速）
 *   ritsu_write_artifact — 产物写入 + 占位符拦截
 *   ritsu_list_artifacts — 产物列表查询
 *   ritsu_exec           — 通用命令执行（带截断/超时/安全边界）
 *   ritsu_validate       — 独立 Schema 校验（纯 WASM）
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  appendEvent,
  readRecentEntries,
  readLastCompleted,
  readLastIncomplete,
  getCtxFilePath,
  resetLineCount,
  syncLineCountFromCtxFile,
  generateCorrelationId,
  getNextSeq,
} from "../ctx-store.js";
import {
  ARTIFACT_VALID_TYPES,
  ARTIFACT_PREFIX_MAP,
  ALLOWED_BINARIES,
  RESIDUAL_BLACKLIST,
} from "../shared.js";
import { validateEvent as validateEventJs } from "../event-validator.js";
import {
  validateEventWasm,
  queryLastIncompleteWasm,
  queryLastCompletedWasm,
  queryPendingApprovalsWasm,
  queryRecentWasm,
  buildIndexFromCtxFile,
  appendToIndexWasm,
  nextCorrelationIdWasm,
} from "../wasm-bridge.js";

const RITSU_DIR = ".ritsu";

function getProjectRoot(): string {
  return process.env.RITSU_PROJECT_ROOT ?? process.cwd();
}

function ts(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(msg: string): CallToolResult {
  return { content: [{ type: "text", text: `❌ ${msg}` }], isError: true };
}

async function runCmd(
  cmd: string,
  maxLines = 200,
  timeoutMs = 30_000,
  maxBufferMb = 10,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", cmd], {
      cwd: getProjectRoot(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const maxBytes = maxBufferMb * 1024 * 1024;

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < maxBytes) stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < maxBytes) stderr += chunk.toString("utf-8");
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, output: stdout || stderr || "timeout" });
    }, timeoutMs);

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      const raw = (code === 0 ? stdout : stderr || stdout).trim();
      const lines = raw.split("\n");
      const truncated = lines.length > maxLines;
      const output = truncated
        ? lines.slice(0, maxLines).join("\n") + "\n⚠️ 输出已截断"
        : raw;
      resolve({ ok: code === 0, output });
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({ ok: false, output: err.message });
    });
  });
}

// ─── Handlers ────────────────────────────────────────────────

async function ritsu_emit_event(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const eventType = String(params.event_type ?? "");
  let correlationId = String(params.correlation_id ?? "");
  const step = params.step ? String(params.step) : undefined;

  if (!eventType) return errorResult("event_type is required");

  const root = getProjectRoot();

  // correlation_id 自动生成 — WASM 优先，JS 回退
  // WASM base_seq 从 ctx 文件扫描真实 max seq，防止进程重启后 ID 重复
  if (!correlationId) {
    const dateStr = ts().slice(0, 8); // YYYYMMDD
    const baseSeq = getNextSeq(root);
    const wasmCid = await nextCorrelationIdWasm(dateStr, baseSeq);
    correlationId = wasmCid ?? generateCorrelationId(root);
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
    // 标记索引需要重建
    _wasmIndexBuilt = false;
    // 从文件重算真实行数，修正 JS 计数器漂移
    syncLineCountFromCtxFile(root);
  }

  return textResult(
    JSON.stringify({
      written: true,
      line_count: result.lineCount,
      ts: event.ts,
      correlation_id: correlationId,
    }),
  );
}

// WASM 索引是否已初始化（进程级单例）
let _wasmIndexBuilt = false;
let _wasmIndexMonth = "";

// 简易异步互斥锁 — 防止并发 ensureWasmIndex 导致重复构建
let _indexMutex: Promise<void> = Promise.resolve();

async function ensureWasmIndex(root: string): Promise<void> {
  // 快速路径：已构建且月份未变
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  if (_wasmIndexBuilt && _wasmIndexMonth === currentMonth) return;

  // 串行化：等待前一个 ensureWasmIndex 完成
  let release: () => void = () => {};
  _indexMutex = _indexMutex.then(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  await _indexMutex;

  try {
    // double-check：可能在等待期间已被其他调用构建
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

async function ritsu_read_ctx(): Promise<CallToolResult> {
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

async function ritsu_write_artifact(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const type = String(params.type ?? "");
  const filename = String(params.filename ?? "");
  const content = String(params.content ?? "");
  const htmlContent = params.html_content ? String(params.html_content) : null;
  const artifactMeta = params.artifact_meta as
    | Record<string, unknown>
    | undefined;

  if (!type || !filename || !content)
    return errorResult("type, filename, content are required");

  // 占位符拦截 — ctx 类型豁免，AGENTS.md (handoff) 也豁免 init 阶段
  const placeholderPattern = /TODO|待定|暂不处理|后续完善|TBD/;
  if (placeholderPattern.test(content) && type !== "ctx") {
    return errorResult(
      "content contains placeholder (TODO/待定/暂不处理/后续完善/TBD), write rejected",
    );
  }

  // 产物类型校验
  if (!ARTIFACT_VALID_TYPES.includes(type as any)) {
    return errorResult(
      `invalid artifact type: ${type}. Valid: ${ARTIFACT_VALID_TYPES.join(", ")}`,
    );
  }

  // 文件名前缀校验（按 artifact-schema.yaml 命名契约）
  const expectedPrefix = ARTIFACT_PREFIX_MAP[type];
  if (expectedPrefix && !filename.startsWith(expectedPrefix)) {
    return errorResult(
      `filename must start with '${expectedPrefix}' for type '${type}', got: ${filename}`,
    );
  }

  // 路径穿越防护
  if (
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    return errorResult(
      "filename must not contain path traversal (..) or directory separators",
    );
  }

  const root = getProjectRoot();
  const dir = resolve(root, RITSU_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const mdPath = resolve(dir, filename);

  // 覆盖保护 — 已存在文件需确认
  if (existsSync(mdPath)) {
    const overwrite = params.overwrite === true || params.overwrite === "true";
    if (!overwrite) {
      return errorResult(
        `file already exists: ${filename}. Set overwrite=true to replace.`,
      );
    }
  }

  writeFileSync(mdPath, content, "utf-8");
  const sizeBytes = statSync(mdPath).size;

  let htmlPath: string | null = null;
  if (htmlContent && (type === "diagnosis" || type === "review-stamp")) {
    const htmlFilename = filename.replace(/\.(md|jsonl)$/, ".html");
    htmlPath = resolve(dir, htmlFilename);
    writeFileSync(htmlPath, htmlContent, "utf-8");
  }

  return textResult(
    JSON.stringify({
      path: mdPath,
      html_path: htmlPath,
      size_bytes: sizeBytes,
      artifact_meta: artifactMeta ?? null,
    }),
  );
}

async function ritsu_list_artifacts(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const type = String(params.type ?? "all");
  const root = getProjectRoot();
  const dir = resolve(root, RITSU_DIR);

  if (!existsSync(dir))
    return textResult(JSON.stringify({ files: [], total_count: 0 }));

  const prefix = type === "all" ? "" : (ARTIFACT_PREFIX_MAP[type] ?? "");
  const entries = readdirSync(dir)
    .map((f: string) => ({ name: f, stat: statSync(resolve(dir, f)) }))
    .filter(({ stat }) => stat.isFile())
    .filter(({ name }) => (prefix ? name.startsWith(prefix) : true))
    .map(({ name, stat }) => ({
      path: resolve(dir, name),
      modified: stat.mtime.toISOString().replace(/[-:T]/g, "").slice(0, 15),
      size_bytes: stat.size,
      artifact_type:
        Object.entries(ARTIFACT_PREFIX_MAP).find(([, p]: [string, string]) =>
          name.startsWith(p),
        )?.[0] ?? "unknown",
    }))
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
      String(b.modified).localeCompare(String(a.modified)),
    );

  return textResult(
    JSON.stringify({ files: entries, total_count: entries.length }),
  );
}

async function ritsu_exec(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const command = String(params.command ?? "");
  const maxLines = Number(params.max_output_lines ?? 200);
  const timeoutMs = Number(params.timeout_ms ?? 30_000);
  const maxBufferMb = Number(params.max_buffer_mb ?? 10);

  if (!command) return errorResult("command is required");

  // 安全边界：白名单 + 残余黑名单
  // 第一层：提取命令二进制名，只允许安全子集
  const trimmedCmd = command.trim();

  // 提取命令链中所有二进制名（处理管道、&&、; 等分隔符）
  const cmdParts = trimmedCmd.split(/\||&&|;|\|\||&/).map((s) => s.trim());
  for (const part of cmdParts) {
    // 去除前导环境变量赋值 (KEY=val cmd ...)
    const stripped = part.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s*/, "").trim();
    const binary = stripped.split(/\s+/)[0];
    if (!binary) continue;
    if (!ALLOWED_BINARIES.has(binary)) {
      return errorResult(
        `command blocked: '${binary}' is not in the allowed binaries list`,
      );
    }
  }

  // 第二层：残余黑名单 — 拦截允许的二进制中的危险用法
  for (const pattern of RESIDUAL_BLACKLIST) {
    if (pattern.test(trimmedCmd)) {
      return errorResult(
        `dangerous command blocked by safety boundary: ${pattern.source}`,
      );
    }
  }

  const r = await runCmd(command, maxLines, timeoutMs, maxBufferMb);
  return textResult(JSON.stringify({ ok: r.ok, output: r.output }));
}

async function ritsu_validate(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const dataJson = String(params.data ?? "");
  const schemaType = String(params.schema_type ?? "ctx_event");

  if (!dataJson) return errorResult("data is required (JSON string)");

  if (schemaType === "ctx_event") {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataJson);
    } catch (e: any) {
      return errorResult(`invalid JSON: ${e.message}`);
    }

    const wasmResult = await validateEventWasm(data);
    const validation = wasmResult ?? validateEventJs(data);

    return textResult(JSON.stringify(validation));
  }

  return errorResult(`unknown schema_type: ${schemaType}`);
}

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
