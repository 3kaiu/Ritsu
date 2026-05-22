import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { ritsu_write_file } from "../src/handlers/write-file.js";

describe("Ritsu Silent MCP Interception & write_file Proxy", () => {
  let testRoot: string;
  let originalEnvRoot: string | undefined;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-proxy-"));
    originalEnvRoot = process.env.RITSU_PROJECT_ROOT;
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    process.env.RITSU_PROJECT_ROOT = originalEnvRoot;
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should write valid files successfully within boundary", async () => {
    const filePath = "src/valid.ts";
    const content = "console.log('Valid write');\n";
    
    const result = await ritsu_write_file({
      path: filePath,
      content: content,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text as string);
    expect(data.success).toBe(true);
    
    const writtenContent = readFileSync(resolve(testRoot, filePath), "utf-8");
    expect(writtenContent).toBe(content);
  });

  it("should block path traversal outside project root", async () => {
    const result = await ritsu_write_file({
      path: "../traversal.ts",
      content: "unsafe",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Path traversal detected");
  });

  it("should block writes outside allowed target_paths boundaries", async () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir, { recursive: true });
    
    writeFileSync(
      join(ritsuDir, "task-claims.json"),
      JSON.stringify([
        {
          span_id: "span-123",
          agent_id: "agent-1",
          claimed_at: new Date().toISOString(),
          target_paths: ["src/allowed/"],
        }
      ]),
      "utf-8"
    );

    const result = await ritsu_write_file({
      path: "src/denied.ts",
      content: "const a = 1;",
      span_id: "span-123",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("❌ [Linter Error]");
    expect(result.content[0].text).toContain("[AP-4] Out of bounds write");
  });
});
