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

const SERVER_VERSION = "3.5.0";

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
