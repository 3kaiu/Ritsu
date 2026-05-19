import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSharedDir } from "./shared.js";
import yaml from "js-yaml";
import { z } from "zod";

type ZodShape = Record<string, z.ZodTypeAny>;

interface CompiledTool {
  name: string;
  description: string;
  inputSchema: z.ZodObject<ZodShape>;
  outputSchema?: z.ZodTypeAny;
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

interface ToolOutputSchemaDefinition {
  type?: string;
  properties?: Record<string, YamlInputField>;
  required?: string[];
}

interface YamlToolDefinition {
  name: string;
  description?: string;
  input?: Record<string, YamlInputField>;
  output_schema?: ToolOutputSchemaDefinition;
  error_shape?: Record<string, unknown>;
  call_template?: Record<string, unknown>;
  validation?: string;
}

interface ToolsYamlDoc {
  tools?: YamlToolDefinition[];
}

/**
 * Converts a YAML input field definition to a Zod schema type.
 * Supports recursive resolution for objects and lists.
 */
function convertFieldToZod(field: YamlInputField): z.ZodTypeAny {
  let type: z.ZodTypeAny;

  switch (field.type) {
    case "enum":
      if (field.values && field.values.length > 0) {
        type = z.enum(field.values as [string, ...string[]]);
      } else {
        type = z.string();
      }
      break;
    case "list":
    case "array": {
      const itemType = field.items
        ? convertFieldToZod(field.items as YamlInputField)
        : z.string();
      type = z.array(itemType);
      break;
    }
    case "object":
      if (field.properties) {
        type = convertInputToZod(field.properties as Record<string, YamlInputField>);
      } else {
        type = z.record(z.string(), z.any());
      }
      break;
    case "number":
    case "integer":
      type = z.number();
      break;
    case "boolean":
      type = z.boolean();
      break;
    default:
      type = z.string();
  }

  if (field.description) {
    type = type.describe(field.description);
  }

  return field.required ? type : type.optional();
}

/**
 * Compiles a set of YAML input fields into a Zod object schema.
 */
function convertInputToZod(
  input: Record<string, YamlInputField>,
): z.ZodObject<ZodShape> {
  const shape: ZodShape = {};

  for (const [key, field] of Object.entries(input)) {
    shape[key] = convertFieldToZod(field);
  }

  return z.object(shape);
}

function convertOutputSchemaToZod(
  schema: ToolOutputSchemaDefinition | undefined,
): z.ZodTypeAny {
  if (!schema || schema.type !== "object" || !schema.properties) {
    return z.any();
  }
  const requiredFields = Array.isArray(schema.required) ? schema.required : [];
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    const field: YamlInputField = { ...prop, required: requiredFields.includes(key) };
    shape[key] = convertFieldToZod(field);
  }
  return z.object(shape);
}

/**
 * Compiles MCP tool definitions from a YAML declaration file.
 * Automatically resolves paths and validates schema integrity.
 */
export async function compileToolsFromYaml(): Promise<CompiledTool[]> {
  const yamlPath = resolve(getSharedDir(), "mcp-tools.yaml");
  const raw = readFileSync(yamlPath, "utf-8");
  const doc = yaml.load(raw) as ToolsYamlDoc | null;

  if (!doc?.tools || !Array.isArray(doc.tools)) {
    throw new Error("mcp-tools.yaml: missing or invalid 'tools' array");
  }

  return doc.tools.map((toolDef) => {
    const tool: CompiledTool = {
      name: toolDef.name,
      description: toolDef.description ?? "",
      inputSchema: toolDef.input
        ? convertInputToZod(toolDef.input)
        : z.object({}),
    };

    // Optional fields with fallback safety
    if (toolDef.output_schema) {
      tool.outputSchema = convertOutputSchemaToZod(toolDef.output_schema);
    }
    if (toolDef.error_shape) tool.error_shape = toolDef.error_shape;
    if (toolDef.call_template) tool.call_template = toolDef.call_template;
    if (toolDef.validation) tool.validation = toolDef.validation;

    return tool;
  });
}
