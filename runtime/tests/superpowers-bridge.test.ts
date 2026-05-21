import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, rmSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

describe("superpowers-bridge", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-sp-"));
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("hasSuperpowers returns false when no indicators exist", async () => {
    const { hasSuperpowers } = await import("../src/orchestration/superpowers-bridge.js");
    expect(hasSuperpowers(testRoot)).toBe(false);
  });

  it("hasSuperpowers detects via AGENTS.md", async () => {
    writeFileSync(resolve(testRoot, "AGENTS.md"), "superpowers workflow enabled\n", "utf-8");
    const { hasSuperpowers } = await import("../src/orchestration/superpowers-bridge.js");
    expect(hasSuperpowers(testRoot)).toBe(true);
  });

  it("hasSuperpowers detects via CLAUDE.md", async () => {
    writeFileSync(resolve(testRoot, "CLAUDE.md"), "# Project\nsuperpowers: true\n", "utf-8");
    const { hasSuperpowers } = await import("../src/orchestration/superpowers-bridge.js");
    expect(hasSuperpowers(testRoot)).toBe(true);
  });

  it("maps Superpowers phases to Ritsu stages", async () => {
    const { getRitsuStageForSuperpowersPhase, SUPERPOWERS_PHASE_MAP } =
      await import("../src/orchestration/superpowers-bridge.js");
    expect(getRitsuStageForSuperpowersPhase("brainstorming")).toBe("think");
    expect(getRitsuStageForSuperpowersPhase("subagent-driven-development")).toBe("dev");
    expect(getRitsuStageForSuperpowersPhase("requesting-code-review")).toBe("review");
    expect(getRitsuStageForSuperpowersPhase("unknown-phase")).toBe("dev");
    expect(Object.keys(SUPERPOWERS_PHASE_MAP).length).toBe(6);
  });

  it("detectSuperpowersPhase returns no superpowers when unavailable", async () => {
    const { detectSuperpowersPhase } = await import("../src/orchestration/superpowers-bridge.js");
    const result = detectSuperpowersPhase(testRoot);
    expect(result.hasSuperpowers).toBe(false);
    expect(result.currentPhase).toBeNull();
    expect(result.ritsuStage).toBe("dev");
  });

  it("detectSuperpowersPhase detects phase from ctx events", async () => {
    // Create AGENTS.md with superpowers reference
    writeFileSync(resolve(testRoot, "AGENTS.md"), "superpowers workflow enabled\n", "utf-8");
    // Create ctx file with phase info
    const ritsuDir = resolve(testRoot, ".ritsu");
    if (!existsSync(ritsuDir)) {
      mkdirSync(ritsuDir, { recursive: true });
    }
    const ctxPath = resolve(ritsuDir, "ctx-2026-05.jsonl");
    writeFileSync(
      ctxPath,
      JSON.stringify({ ts: "20260522-120000", phase: "subagent-driven-development", status: "started", skill: "dev" }) + "\n",
      "utf-8",
    );

    const { detectSuperpowersPhase } = await import("../src/orchestration/superpowers-bridge.js");
    const result = detectSuperpowersPhase(testRoot);
    expect(result.hasSuperpowers).toBe(true);
    expect(result.currentPhase).toBe("subagent-driven-development");
    expect(result.ritsuStage).toBe("dev");
  });
});
