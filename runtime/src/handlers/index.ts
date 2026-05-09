/**
 * 工具 Handler 注册表
 *
 * 每个 handler 接收 MCP CallToolRequest 的参数，返回 CallToolResult。
 * projectRoot 从环境变量 RITSU_PROJECT_ROOT 或 process.cwd() 获取。
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve, basename } from "node:path";
import {
  appendEvent,
  generateCorrelationId,
  readLastCompleted,
  readLastIncomplete,
  readRecentEntries,
} from "../ctx-store.js";
import { validateEvent } from "../event-validator.js";

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

function runCmd(cmd: string, maxLines = 200): { ok: boolean; output: string } {
  try {
    const raw = execSync(cmd, {
      cwd: getProjectRoot(),
      encoding: "utf-8",
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    const lines = raw.trim().split("\n");
    const truncated = lines.length > maxLines;
    const output = truncated
      ? lines.slice(0, maxLines).join("\n") + "\n⚠️ 输出已截断"
      : raw;
    return { ok: true, output };
  } catch (e: any) {
    return { ok: false, output: e.stdout ?? e.message ?? String(e) };
  }
}

// ─── Handlers ────────────────────────────────────────────────

async function ritsu_get_changed_files(): Promise<CallToolResult> {
  const excludes =
    "-- . ':(exclude)*lock*' ':(exclude)*.svg' ':(exclude)*.map' ':(exclude)*.min.js'";
  const r1 = runCmd(`git diff --name-only ${excludes}`);
  const r2 = runCmd(`git diff --name-only --cached ${excludes}`);

  if (!r1.ok && !r2.ok) return errorResult("not a git repo");

  const files1 = r1.ok ? r1.output.trim().split("\n").filter(Boolean) : [];
  const files2 = r2.ok ? r2.output.trim().split("\n").filter(Boolean) : [];
  const merged = [...new Set([...files1, ...files2])];
  const extensions = [
    ...new Set(merged.map((f) => basename(f).split(".").pop()!)),
  ];

  return textResult(
    JSON.stringify({ files: merged, extensions, total_files: merged.length }),
  );
}

async function ritsu_get_diff(): Promise<CallToolResult> {
  const excludes =
    "-- . ':(exclude)*lock*' ':(exclude)*.svg' ':(exclude)*.map' ':(exclude)*.min.js'";
  const r1 = runCmd(`git diff ${excludes}`, 500);
  const r2 = runCmd(`git diff --cached ${excludes}`, 500);

  if (!r1.ok && !r2.ok) return errorResult("not a git repo");

  const diff = [r1.output, r2.output].filter(Boolean).join("\n");
  return textResult(JSON.stringify({ diff_content: diff, truncated: false }));
}

async function ritsu_grep_identifier(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const identifier = String(params.identifier ?? "");
  const extensions = (params.extensions as string[]) ?? [];

  if (!identifier) return errorResult("identifier is required");

  const includeFlags = extensions.map((ext) => `--include="*${ext}"`).join(" ");
  const cmd = `grep -rnC 3 --max-count=10 "${identifier}" . ${includeFlags} --exclude-dir={node_modules,.git,dist,build,out,vendor}`;

  const r = runCmd(cmd, 80);
  const found = r.ok && r.output.trim().length > 0;

  const matches = found
    ? r.output
        .trim()
        .split("\n--\n")
        .slice(0, 10)
        .map((chunk) => {
          const firstLine = chunk.split("\n")[0] ?? "";
          const [fileLine, ...rest] = firstLine.split(":");
          return { file: fileLine, context: rest.join(":") || chunk };
        })
    : [];

  return textResult(
    JSON.stringify({ found, matches, total_matches: matches.length }),
  );
}

async function ritsu_run_quality_gates(): Promise<CallToolResult> {
  const root = getProjectRoot();
  const agentsPath = resolve(root, "AGENTS.md");

  if (!existsSync(agentsPath))
    return errorResult("AGENTS.md not found, run /r-init first");

  const content = readFileSync(agentsPath, "utf-8");
  const lintMatch = content.match(/Lint[：:]\s*`?([^`\n]+)/);
  const testMatch = content.match(/Test[：:]\s*`?([^`\n]+)/);

  const lintCmd = lintMatch?.[1]?.trim();
  const testCmd = testMatch?.[1]?.trim();

  const lint = lintCmd
    ? runCmd(lintCmd)
    : { ok: false, output: "Lint command not defined" };
  const test = testCmd
    ? runCmd(testCmd)
    : { ok: false, output: "Test command not defined" };

  return textResult(
    JSON.stringify({
      lint: { passed: lint.ok, output: lint.output.slice(0, 500) },
      test: { passed: test.ok, output: test.output.slice(0, 500) },
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

  // 占位符检查
  if (/TODO|待定|暂不处理/.test(content) && type !== "ctx") {
    return errorResult(
      "content contains placeholder (TODO/待定/暂不处理), write rejected",
    );
  }

  const root = getProjectRoot();
  const dir = resolve(root, RITSU_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const mdPath = resolve(dir, filename);
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

  const typeMap: Record<string, string> = {
    handoff: "handoff-",
    diagnosis: "diagnosis-",
    "review-stamp": "review-stamp-",
    "optimize-report": "optimize-report-",
    ctx: "ctx-",
  };

  const prefix = type === "all" ? "" : (typeMap[type] ?? "");
  const entries = readdirSync(dir)
    .filter((f) => (prefix ? f.startsWith(prefix) : true))
    .filter((f) => statSync(resolve(dir, f)).isFile())
    .map((f) => {
      const stat = statSync(resolve(dir, f));
      return {
        path: resolve(dir, f),
        modified: stat.mtime.toISOString().replace(/[-:T]/g, "").slice(0, 15),
        size_bytes: stat.size,
        artifact_type:
          Object.entries(typeMap).find(([, p]) => f.startsWith(p))?.[0] ??
          "unknown",
      };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));

  return textResult(
    JSON.stringify({ files: entries, total_count: entries.length }),
  );
}

async function ritsu_read_ctx(): Promise<CallToolResult> {
  const root = getProjectRoot();
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

async function ritsu_retrieve_memory(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const query = String(params.query ?? "");
  if (!query) return errorResult("query is required");

  const root = getProjectRoot();
  const cmd = `grep -rni --max-count=5 "${query}" .ritsu/ --include="*.md" --include="*.html" --include="*.jsonl"`;
  const r = runCmd(cmd, 100);

  const matches = r.ok
    ? r.output
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [fileLine, ...rest] = line.split(":");
          return { file: fileLine, context: rest.join(":") };
        })
    : [];

  return textResult(JSON.stringify({ matches, total_matches: matches.length }));
}

async function ritsu_emit_event(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const eventType = String(params.event_type ?? "");
  const correlationId = String(params.correlation_id ?? "");
  const step = params.step ? String(params.step) : undefined;

  if (!eventType) return errorResult("event_type is required");
  if (!correlationId) return errorResult("correlation_id is required");

  const root = getProjectRoot();
  const domain = "unknown"; // domain 由 LLM 从 AGENTS.md 推断后传入

  const event: Record<string, unknown> = {
    ts: ts(),
    correlation_id: correlationId,
    skill: "unknown", // 由 LLM 填入
    domain: params.domain ?? domain,
    status: eventType,
    step: step ?? null,
    artifact: params.artifact ?? null,
    progress: params.progress ?? null,
  };

  // 可选字段
  if (params.error) event.error = String(params.error);
  if (params.approval) event.approval = params.approval;
  if (params.artifact_meta) event.artifact_meta = params.artifact_meta;
  if (params.violation) event.violation = params.violation;
  if (params.redirect) event.redirect = String(params.redirect);
  if (params.transition) event.transition = params.transition;
  if (params.duration_ms) event.duration_ms = Number(params.duration_ms);

  // Schema 校验
  const validation = validateEvent(event);
  if (!validation.valid) {
    return errorResult(
      `event validation failed: ${validation.errors?.join(", ")}`,
    );
  }

  const result = appendEvent(root, event);
  return textResult(
    JSON.stringify({ written: true, line_count: result.lineCount, event }),
  );
}

// ─── Handler Registry ────────────────────────────────────────

export const registerHandlers: Record<
  string,
  (params: Record<string, unknown>) => Promise<CallToolResult>
> = {
  ritsu_get_changed_files,
  ritsu_get_diff,
  ritsu_grep_identifier,
  ritsu_run_quality_gates,
  ritsu_write_artifact,
  ritsu_list_artifacts,
  ritsu_read_ctx,
  ritsu_retrieve_memory,
  ritsu_emit_event,
};
