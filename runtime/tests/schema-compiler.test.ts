import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { compileToolsFromYaml } from "../src/schema-compiler.js";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

describe("schema-compiler", () => {
  const shared = resolve("./test-shared-compiler");

  beforeEach(() => {
    process.env.RITSU_SHARED_DIR = shared;
    if (!existsSync(shared)) mkdirSync(shared, { recursive: true });
  });

  afterEach(() => {
    rmSync(shared, { recursive: true, force: true });
  });

  it("compiles tools from valid YAML", async () => {
    const yamlContent = `
tools:
  - name: test_tool
    description: A tool for testing
    input:
      param1:
        type: string
        required: true
        description: A test parameter
      param2:
        type: number
        required: false
`;
    writeFileSync(resolve(shared, "mcp-tools.yaml"), yamlContent);

    const tools = await compileToolsFromYaml();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("test_tool");
    expect(tools[0].inputSchema.shape.param1).toBeDefined();
    expect(tools[0].inputSchema.shape.param2).toBeDefined();
  });

  it("handles complex types (enum, list, object)", async () => {
    const yamlContent = `
tools:
  - name: complex_tool
    input:
      my_enum:
        type: enum
        values: [a, b, c]
      my_list:
        type: list
        items:
          type: string
      my_obj:
        type: object
        properties:
          sub_field:
            type: boolean
`;
    writeFileSync(resolve(shared, "mcp-tools.yaml"), yamlContent);

    const tools = await compileToolsFromYaml();
    const schema = tools[0].inputSchema.shape;
    
    expect(schema.my_enum).toBeDefined();
    expect(schema.my_list).toBeDefined();
    expect(schema.my_obj).toBeDefined();
  });

  it("falls back for loose field definitions and preserves optional metadata", async () => {
    const yamlContent = `
tools:
  - name: fallback_tool
    description: fallback paths
    input:
      enum_without_values:
        type: enum
      list_without_items:
        type: array
      object_without_properties:
        type: object
      unknown_field:
        type: mystery
        description: Unknown becomes string
    output_schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
        count:
          type: integer
    error_shape:
      retryable: true
    call_template:
      mode: dry-run
    validation: custom-rule
  - name: empty_input_tool
`;
    writeFileSync(resolve(shared, "mcp-tools.yaml"), yamlContent);

    const tools = await compileToolsFromYaml();
    const [fallbackTool, emptyInputTool] = tools;

    expect(fallbackTool.description).toBe("fallback paths");
    expect(fallbackTool.inputSchema.safeParse({
      enum_without_values: "ok",
      list_without_items: ["a", "b"],
      object_without_properties: { any: 1 },
      unknown_field: "free-form",
    }).success).toBe(true);
    expect(
      fallbackTool.outputSchema?.safeParse({ status: "ok", count: 2 }).success,
    ).toBe(true);
    expect(
      fallbackTool.outputSchema?.safeParse({ count: 2 }).success,
    ).toBe(false);
    expect(fallbackTool.error_shape).toEqual({ retryable: true });
    expect(fallbackTool.call_template).toEqual({ mode: "dry-run" });
    expect(fallbackTool.validation).toBe("custom-rule");
    expect(emptyInputTool.inputSchema.safeParse({}).success).toBe(true);
  });

  it("returns z.any output schemas for unsupported output definitions", async () => {
    writeFileSync(
      resolve(shared, "mcp-tools.yaml"),
      `
tools:
  - name: any_output_tool
    output_schema:
      type: list
`,
      "utf-8",
    );

    const [tool] = await compileToolsFromYaml();
    expect(tool.outputSchema?.safeParse(["anything"]).success).toBe(true);
    expect(tool.outputSchema?.safeParse({ mixed: "object" }).success).toBe(true);
  });

  it("throws when the tools array is missing or invalid", async () => {
    writeFileSync(resolve(shared, "mcp-tools.yaml"), "tools: {}", "utf-8");
    await expect(compileToolsFromYaml()).rejects.toThrow(
      "mcp-tools.yaml: missing or invalid 'tools' array",
    );
  });
});
