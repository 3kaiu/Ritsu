#!/usr/bin/env node
/**
 * Ritsu MCP Server — 将 _shared/mcp-tools.yaml 声明编译为可运行的 MCP 工具服务
 *
 * 架构：
 *   mcp-tools.yaml → schema-compiler.ts → MCP Tool definitions
 *   ctx-event-schema.json → ajv validator → 事件写入前校验
 *   各 tool handler → 实际执行（direct spawn / fs / git）
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { compileToolsFromYaml } from "./schema-compiler.js";
import { registerHandlers } from "./handlers/index.js";
import { readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 从 package.json 读取版本号，单一事实来源
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "../package.json"), "utf-8"),
);
const SERVER_VERSION: string = pkg.version;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getTextContent(result: CallToolResult): string | null {
  const firstContent = result.content[0];
  if (firstContent?.type === "text" && typeof firstContent.text === "string") {
    return firstContent.text;
  }
  return null;
}

function hasErrorField(value: unknown): value is { error: unknown } {
  return typeof value === "object" && value !== null && "error" in value;
}

/**
 * Normalizes plain-text tool errors to structured JSON format.
 * If the result is already structured (JSON-parseable error field), returns null (no-op).
 * If the result is a plain text error, wraps it in the structured RitsuToolError format.
 */
function normalizeToolError(result: CallToolResult): CallToolResult | null {
  if (!result.isError) return null;
  const firstContent = result.content[0];
  if (firstContent?.type !== "text" || typeof firstContent.text !== "string") return null;

  if (firstContent.text.includes("❌ [Linter Error]")) {
    return null;
  }

  // Check if already structured JSON
  try {
    const parsed = JSON.parse(firstContent.text) as unknown;
    if (hasErrorField(parsed)) return null;
  } catch { /* plain text, proceed with normalization */ }


  // Wrap plain text error in structured format
  const cleanMessage = firstContent.text.replace(/^❌\s*/, "");
  const structured = {
    error: {
      type: "ExecutionError" as const,
      code: "TOOL_ERROR",
      message: cleanMessage,
    },
  };
  firstContent.text = JSON.stringify(structured);
  return result;
}

async function main() {
  // 版本一致性校验 — package.json 版本必须与 ctx-event-schema.json 版本对齐
  const schemaPath = resolve(__dirname, "../../_shared/ctx-event-schema.json");
  if (existsSync(schemaPath)) {
    const schemaContent = readFileSync(schemaPath, "utf-8");
    const schemaVersionMatch = schemaContent.match(/v(\d+\.\d+\.\d+)/);
    if (schemaVersionMatch && schemaVersionMatch[1] !== SERVER_VERSION) {
      const message = `[ritsu-mcp-server] ⚠️  version mismatch: package.json=${SERVER_VERSION} schema=${schemaVersionMatch[1]}`;
      if (process.env.RITSU_STRICT === '1') {
        throw new Error(message);
      } else {
        console.warn(message);
      }
    }
  }

  const server = new McpServer({
    name: "ritsu-mcp-server",
    version: SERVER_VERSION,
  });

  // 从 YAML 编译工具定义
  const tools = await compileToolsFromYaml();

  // 注册工具 + handler
  for (const tool of tools) {
    const rawHandler =
      registerHandlers[tool.name] ??
      (async (): Promise<CallToolResult> => ({
        content: [{ type: "text" as const, text: "handler not implemented" }],
      }));

    const wrappedHandler = async (params: unknown): Promise<CallToolResult> => {
      const safeParams =
        typeof params === "object" && params !== null && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : {};
      const result = await rawHandler(safeParams);
      const normalized = normalizeToolError(result);
      if (normalized) return normalized;
      const isProd = process.env.NODE_ENV === "production";
      const strictMode = process.env.RITSU_STRICT_OUTPUT ?? (isProd ? "warn" : "1");
      const textContent = getTextContent(result);

      if (strictMode !== "0" && tool.outputSchema && textContent) {
        try {
          const parsedContent = JSON.parse(textContent) as unknown;
          if (!hasErrorField(parsedContent)) {
            tool.outputSchema.parse(parsedContent);
          }
        } catch (error: unknown) {
          const message = getErrorMessage(error);
          if (strictMode === "warn") {
            console.warn(`[ritsu-mcp-server] ⚠️  STRICT_OUTPUT_WARN for tool '${tool.name}': ${message}`);
          } else {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: "STRICT_OUTPUT_ERROR", tool: tool.name, message }) }],
              isError: true,
            };
          }
        }
      }
      return result;
    };

    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema.shape,
      wrappedHandler,
    );
  }

  // 启动 stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[ritsu-mcp-server v${SERVER_VERSION}] started on stdio`);
}

main().catch((err) => {
  console.error("[ritsu-mcp-server] fatal:", err);
  process.exit(1);
});

// 优雅关闭 — 清理残留锁文件和临时文件
function gracefulShutdown(signal: string) {
  console.error(`[ritsu-mcp-server] received ${signal}, shutting down...`);

  // 清理 .ritsu 目录中的残留锁文件和临时文件
  const projectRoot = process.env.RITSU_PROJECT_ROOT ?? process.cwd();
  const ritsuDir = resolve(projectRoot, ".ritsu");
  if (existsSync(ritsuDir)) {
    try {
      for (const f of readdirSync(ritsuDir)) {
        // proper-lockfile 残留锁
        if (f.endsWith(".lock")) {
          rmSync(resolve(ritsuDir, f), { force: true });
        }
        // 原子写入残留临时文件
        if (f.startsWith(".tmp-")) {
          rmSync(resolve(ritsuDir, f), { force: true });
        }
      }
    } catch {
      // 尽力清理，不阻塞关闭
    }
  }

  // Auto-sync on shutdown
  if (process.env.RITSU_AUTO_SYNC !== '0') {
    const cliPath = resolve(__dirname, "cli.js");
    if (existsSync(cliPath)) {
      try {
        const child = spawn(process.execPath, [cliPath, "sync", "push"], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
      } catch {
        // ignore
      }
    }
  }

  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
