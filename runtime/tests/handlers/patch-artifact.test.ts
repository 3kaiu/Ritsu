import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ritsu_patch_artifact } from "../../src/handlers/patch-artifact.js";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { getCtxPath } from "../../src/ctx-path.js";

vi.mock("../../src/policy/index.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    evaluatePolicies: vi.fn((ctx: any) => {
      if (ctx.content && ctx.content.includes("TODO")) {
        return {
          passed: false,
          violations: [
            { severity: "hard_stop", message: "content contains placeholder", rule_id: "HC-2" }
          ]
        };
      }
      return { passed: true, violations: [] };
    })
  };
});

describe("ritsu_patch_artifact", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-patch-artifact-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should replace target content successfully", async () => {
    const ritsuDir = resolve(testRoot, ".ritsu");
    mkdirSync(ritsuDir, { recursive: true });
    
    const filename = "design-sheet-test.md";
    const filePath = resolve(ritsuDir, filename);
    writeFileSync(filePath, "Hello World!\nSome standard text.", "utf-8");

    const result = await ritsu_patch_artifact({
      filename,
      target_content: "standard text",
      replacement_content: "updated text",
    });

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.patched).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe("Hello World!\nSome updated text.");

    // Verify ctx event
    const ctxLines = readFileSync(getCtxPath(testRoot), "utf-8").trim().split("\n");
    const event = JSON.parse(ctxLines[0]);
    expect(event.status).toBe("artifact_written");
    expect(event.artifact).toBe(filename);
    expect(event.artifact_meta.type).toBe("patch");
  });

  it("should enforce policies and reject forbidden content (e.g. TODO)", async () => {
    const ritsuDir = resolve(testRoot, ".ritsu");
    mkdirSync(ritsuDir, { recursive: true });
    
    const filename = "design-sheet-test.md";
    const filePath = resolve(ritsuDir, filename);
    writeFileSync(filePath, "Hello World!\nSome standard text.", "utf-8");

    const result = await ritsu_patch_artifact({
      filename,
      target_content: "standard text",
      replacement_content: "TODO item",
    });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error.type).toBe("ArtifactWriteError");
    expect(data.error.violations[0].code).toBe("policy_violation");
    expect(data.error.violations[0].message).toContain("[HC-2] content contains placeholder");

    // The file should NOT be changed
    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe("Hello World!\nSome standard text.");

    // Verify violation event in log
    const ctxLines = readFileSync(getCtxPath(testRoot), "utf-8").trim().split("\n");
    const event = JSON.parse(ctxLines[0]);
    expect(event.status).toBe("violation_detected");
    expect(event.violation.rule_id).toBe("HC-2");
  });

  it("should prevent path traversal", async () => {
    const result = await ritsu_patch_artifact({
      filename: "../secret.txt",
      target_content: "x",
      replacement_content: "y",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("path traversal");
  });

  it("should fail if file does not exist", async () => {
    const result = await ritsu_patch_artifact({
      filename: "nonexistent.md",
      target_content: "x",
      replacement_content: "y",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("file not found");
  });

  it("should fail if target_content is not found", async () => {
    const ritsuDir = resolve(testRoot, ".ritsu");
    mkdirSync(ritsuDir, { recursive: true });
    writeFileSync(resolve(ritsuDir, "test.md"), "hello", "utf-8");

    const result = await ritsu_patch_artifact({
      filename: "test.md",
      target_content: "world",
      replacement_content: "y",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("target_content not found");
  });
});
