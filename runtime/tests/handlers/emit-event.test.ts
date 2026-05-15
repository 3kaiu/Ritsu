import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ritsu_emit_event } from "../../src/handlers/emit-event.js";
import { getCtxPath, ensureCtxFile } from "../../src/ctx-path.js";
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ritsu_emit_event", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-emit-event-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    ensureCtxFile(testRoot);
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should emit a started event with step", async () => {
    const params = {
      event_type: "started",
      skill: "think",
      domain: "frontend",
      step: "1/4",
    };

    const result = await ritsu_emit_event(params);
    expect(result.isError).toBeUndefined();
    
    const data = JSON.parse(result.content[0].text);
    expect(data.written).toBe(true);
    expect(data.correlation_id).toBeDefined();

    const ctxPath = getCtxPath(testRoot);
    const content = readFileSync(ctxPath, "utf-8").trim();
    const event = JSON.parse(content);
    expect(event.status).toBe("started");
    expect(event.step).toBe("1/4");
    expect(event.correlation_id).toBe(data.correlation_id);
  });

  it("should validate events with correlation_id", async () => {
    // Missing step for started event
    const params = {
      event_type: "started",
      correlation_id: "cid-20260515-999",
      skill: "think",
      domain: "frontend",
    };

    const result = await ritsu_emit_event(params);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("validation failed");
  });

  it("should handle artifact_written event", async () => {
    const params = {
      event_type: "artifact_written",
      skill: "dev",
      domain: "fullstack",
      artifact: ".ritsu/dev-report-test.md",
      artifact_meta: {
        type: "dev-report",
        size_bytes: 1024,
        summary: "test report"
      }
    };

    const result = await ritsu_emit_event(params);
    expect(result.isError).toBeUndefined();

    const ctxPath = getCtxPath(testRoot);
    const lastLine = readFileSync(ctxPath, "utf-8").trim().split("\n").pop()!;
    const event = JSON.parse(lastLine);
    expect(event.status).toBe("artifact_written");
    expect(event.artifact_meta.canonical_type).toBe("dev-report");
  });
});
