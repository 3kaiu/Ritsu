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
import { compileToolsFromYaml } from "./schema-compiler.js";
import { registerHandlers } from "./handlers/index.js";
import { readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 从 package.json 读取版本号，单一事实来源
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "../package.json"), "utf-8"),
);
const SERVER_VERSION: string = pkg.version;

async function main() {
  // 版本一致性校验 — package.json 版本必须与 ctx-event-schema.json 版本对齐
  const schemaPath = resolve(__dirname, "../../_shared/ctx-event-schema.json");
  if (existsSync(schemaPath)) {
    const schemaContent = readFileSync(schemaPath, "utf-8");
    const schemaVersionMatch = schemaContent.match(/v(3\.\d+\.\d+)/);
    if (schemaVersionMatch && schemaVersionMatch[1] !== SERVER_VERSION) {
      console.warn(
        `[ritsu-mcp-server] ⚠️  version mismatch: package.json=${SERVER_VERSION} schema=${schemaVersionMatch[1]}`,
      );
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

  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
