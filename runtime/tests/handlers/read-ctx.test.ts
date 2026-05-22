import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ritsu_read_ctx } from "../../src/handlers/ctx-controller.js";
import { ritsu_emit_event } from "../../src/handlers/emit-event.js";
import { getCtxPath, ensureCtxFile } from "../../src/ctx-path.js";
import { _resetReaderCache } from "../../src/ctx-reader.js";
import { _resetWriterCache } from "../../src/ctx-writer.js";
import { _resetCorrelationCache } from "../../src/correlation.js";
import { existsSync, rmSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ritsu_read_ctx", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-read-ctx-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
    ensureCtxFile(testRoot);
    _resetReaderCache();
    _resetWriterCache();
    _resetCorrelationCache();
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  async function emit(params: any) {
    // Ensure valid domain and other required fields for schema
    const p = {
        domain: "fullstack",
        skill: "think",
        ...params
    };
    const res = await ritsu_emit_event(p);
    if (res.isError) {
        throw new Error(`Emit failed: ${res.content[0].text}`);
    }
    return JSON.parse(res.content[0].text);
  }

  it("should return warning for empty ctx", async () => {
    const result = await ritsu_read_ctx({});
    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.last_incomplete).toBeNull();
    expect(data.recovery_context).toBeDefined();
  });

  it("should track last incomplete and completed events", async () => {
    // 1. Start a think task
    const startData = await emit({
      event_type: "started",
      step: "0/3"
    });

    let res = await ritsu_read_ctx({});
    let data = JSON.parse(res.content[0].text);
    expect(data.last_incomplete.status).toBe("started");

    // 2. Complete it
    await emit({
      event_type: "done",
      step: "3/3",
      correlation_id: startData.correlation_id
    });

    res = await ritsu_read_ctx({});
    data = JSON.parse(res.content[0].text);
    
    if (data.last_incomplete !== null) {
        const ctxPath = getCtxPath(testRoot);
        console.error("FAIL: last_incomplete should be null but is:", JSON.stringify(data.last_incomplete));
        console.error("FILE CONTENT:", readFileSync(ctxPath, "utf-8"));
    }
    
    expect(data.last_incomplete).toBeNull();
    expect(data.last_completed.status).toBe("done");
  });

  it("should detect circuit breaker and suggest think", async () => {
     // Emit 2 failed events for same task
     const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
     const cid = `cid-${today}-999`;
     await emit({ event_type: "started", skill: "dev", step: "1/1", correlation_id: cid });
     await emit({ event_type: "failed", skill: "dev", correlation_id: cid, error: "err1" });
     await emit({ event_type: "failed", skill: "dev", correlation_id: cid, error: "err2" });

     const res = await ritsu_read_ctx({ detail: true });
     const data = JSON.parse(res.content[0].text);
     
     if (data.circuit_breaker_status.should_redirect !== "think") {
         console.error("CIRCUIT BREAKER FAIL:", JSON.stringify(data.circuit_breaker_status));
         const ctxPath = getCtxPath(testRoot);
         console.error("FILE CONTENT:", readFileSync(ctxPath, "utf-8"));
     }
     
     expect(data.circuit_breaker_status.should_redirect).toBe("think");
     expect(data.recommended_next_step).toContain("/r-think");
  });
});
