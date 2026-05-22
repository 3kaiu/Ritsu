import { describe, it, expect } from "vitest";

describe("native-bridge", () => {
  it("computeSimpleEmbedding produces consistent vector size", async () => {
    const { computeSimpleEmbedding } = await import("../src/native-bridge.js");
    const vec = computeSimpleEmbedding("console.log should be avoided");
    expect(vec.length).toBe(128);
    // All values should be normalized (magnitude ≈ 1)
    const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(magnitude).toBeGreaterThan(0.9);
    expect(magnitude).toBeLessThan(1.1);
  });

  it("computeSimpleEmbedding is deterministic for same input", async () => {
    const { computeSimpleEmbedding } = await import("../src/native-bridge.js");
    const a = computeSimpleEmbedding("use const instead of let");
    const b = computeSimpleEmbedding("use const instead of let");
    expect(a).toEqual(b);
  });

  it("computeSimpleEmbedding differs for different inputs", async () => {
    const { computeSimpleEmbedding } = await import("../src/native-bridge.js");
    const a = computeSimpleEmbedding("use const instead of let");
    const b = computeSimpleEmbedding("prefer async/await over callbacks");
    const diff = a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);
    expect(diff).toBeGreaterThan(0.01);
  });

  it("isNativeAvailable returns true in Bun environment", async () => {
    const { isNativeAvailable } = await import("../src/native-bridge.js");
    expect(isNativeAvailable()).toBe(true);
  });

  it("initNativeStore returns true when native database initializes successfully", async () => {
    const { initNativeStore, closeNativeStore } = await import("../src/native-bridge.js");
    const { mkdtempSync, rmSync, existsSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");
    
    const tempRoot = mkdtempSync(join(tmpdir(), "ritsu-test-vector-store-"));
    process.env.RITSU_PROJECT_ROOT = tempRoot;

    try {
      expect(initNativeStore(tempRoot)).toBe(true);
    } finally {
      closeNativeStore();
      delete process.env.RITSU_PROJECT_ROOT;
      if (existsSync(tempRoot)) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });
});
