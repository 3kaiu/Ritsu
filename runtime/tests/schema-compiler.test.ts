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
});
