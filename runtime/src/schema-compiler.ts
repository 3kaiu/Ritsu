/**
 * Schema Compiler — 从 _shared/mcp-tools.yaml 编译 MCP Tool 定义
 *
 * 读取 YAML 文件，将每个 tool 的 input 字段转换为 JSON Schema (inputSchema)，
 * output_schema 保留供 UI 消费（不传给 MCP 协议，MCP 协议只定义 input）。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSharedDir } from "./shared.js";
import yaml from "js-yaml";

interface CompiledTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  callTemplate?: Record<string, unknown>;
  validation?: string;
}

interface YamlInputField {
  type: string;
  required?: boolean;
  description?: string;
  values?: string[];
  items?: unknown;
  properties?: Record<string, unknown>;
}

function convertInputToJsonSchema(
  input: Record<string, YamlInputField>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(input)) {
    if (field.type === "enum" && field.values) {
      properties[key] = {
        type: "string",
        enum: field.values,
        description: field.description ?? "",
      };
    } else if (field.type === "list") {
      properties[key] = {
        type: "array",
        items: { type: "string" },
        description: field.description ?? "",
      };
    } else if (field.type === "object") {
      properties[key] = {
        type: "object",
        description: field.description ?? "",
        ...(field.properties ? { properties: field.properties } : {}),
      };
    } else {
      properties[key] = {
        type: field.type,
        description: field.description ?? "",
      };
    }
    if (field.required) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

export async function compileToolsFromYaml(): Promise<CompiledTool[]> {
  const yamlPath = resolve(getSharedDir(), "mcp-tools.yaml");
  const raw = readFileSync(yamlPath, "utf-8");
  const doc = yaml.load(raw) as { tools: unknown[] };

  if (!doc.tools || !Array.isArray(doc.tools)) {
    throw new Error("mcp-tools.yaml: missing or invalid 'tools' array");
  }

  return doc.tools.map((t: any) => {
    const tool: CompiledTool = {
      name: t.name,
      description: t.description,
      inputSchema: t.input
        ? convertInputToJsonSchema(t.input as Record<string, YamlInputField>)
        : { type: "object", properties: {} },
    };

    // 保留非 MCP 协议字段供 handler 使用
    if (t.output_schema) tool.outputSchema = t.output_schema;
    if (t.call_template) tool.callTemplate = t.call_template;
    if (t.validation) tool.validation = t.validation;

    return tool;
  });
}
