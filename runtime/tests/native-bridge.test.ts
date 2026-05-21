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

  it("isNativeAvailable returns false when .node file missing", async () => {
    const { isNativeAvailable } = await import("../src/native-bridge.js");
    // In test environment, no native .node file should be found
    expect(isNativeAvailable()).toBe(false);
  });

  it("initNativeStore returns false when native unavailable", async () => {
    const { initNativeStore } = await import("../src/native-bridge.js");
    expect(initNativeStore()).toBe(false);
  });
});
