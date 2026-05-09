#!/usr/bin/env node
/**
 * Ritsu MCP Server — 将 _shared/mcp-tools.yaml 声明编译为可运行的 MCP 工具服务
 *
 * 架构：
 *   mcp-tools.yaml → schema-compiler.ts → MCP Tool definitions
 *   ctx-event-schema.json → ajv validator → 事件写入前校验
 *   各 tool handler → 实际执行（shell / fs / git）
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { compileToolsFromYaml } from "./schema-compiler.js";
import { registerHandlers } from "./handlers/index.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 从 package.json 读取版本号，单一事实来源
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "../package.json"), "utf-8"),
);
const SERVER_VERSION: string = pkg.version;

async function main() {
  const server = new McpServer({
    name: "ritsu-mcp-server",
    version: SERVER_VERSION,
  });

  // 从 YAML 编译工具定义
  const tools = await compileToolsFromYaml();

  // 注册工具 + handler
  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema,
      registerHandlers[tool.name] ??
        (async () => ({
          content: [{ type: "text", text: "handler not implemented" }],
        })),
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

// 优雅关闭 — 清理残留锁文件
function gracefulShutdown(signal: string) {
  console.error(`[ritsu-mcp-server] received ${signal}, shutting down...`);
  // proper-lockfile 的锁文件会在 unlockSync 时自动删除
  // 此处仅做日志，MCP SDK 会处理 transport 关闭
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
