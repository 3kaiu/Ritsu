import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSharedDir } from "./shared.js";
import yaml from "js-yaml";
import { z } from "zod";

interface CompiledTool {
  name: string;
  description: string;
  inputSchema: z.ZodObject<any>;
  outputSchema?: Record<string, unknown>;
  error_shape?: Record<string, unknown>;
  call_template?: Record<string, unknown>;
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

function convertInputToZod(
  input: Record<string, YamlInputField>,
): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, field] of Object.entries(input)) {
    let type: z.ZodTypeAny;

    if (field.type === "enum" && field.values && field.values.length > 0) {
      type = z.enum(field.values as [string, ...string[]]);
    } else if (field.type === "list" || field.type === "array") {
      type = z.array(z.string());
    } else if (field.type === "object") {
      type = z.any(); // Simplified for now
    } else if (field.type === "number" || field.type === "integer") {
      type = z.number();
    } else if (field.type === "boolean") {
      type = z.boolean();
    } else {
      type = z.string();
    }

    if (field.description) {
      type = type.describe(field.description);
    }

    if (!field.required) {
      type = type.optional();
    }

    shape[key] = type;
  }

  return z.object(shape);
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
        ? convertInputToZod(t.input as Record<string, YamlInputField>)
        : z.object({}),
    };

    if (t.output_schema) tool.outputSchema = t.output_schema;
    if (t.error_shape) tool.error_shape = t.error_shape;
    if (t.call_template) tool.call_template = t.call_template;
    if (t.validation) tool.validation = t.validation;

    return tool;
  });
}
