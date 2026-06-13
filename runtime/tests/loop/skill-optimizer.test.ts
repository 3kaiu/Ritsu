import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  analyzeSkillPerformance,
  proposeSkillOptimization,
  validateSkillProposal,
  type SkillOptConfig,
} from "../../src/loop/skill-optimizer.js";
import { existsSync, rmSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getCtxPath } from "../../src/ctx-path.js";

// Mock llm-synthesizer config
vi.mock("../../src/llm-synthesizer.js", () => ({
  getConfig: () => ({
    endpoint: "https://api.openai.com/v1",
    apiKey: "mock-key",
    model: "gpt-4",
    enabled: true,
  }),
}));

describe("skill optimizer", () => {
  let testRoot: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-optimizer-"));
    originalEnv = { ...process.env };
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe("analyzeSkillPerformance", () => {
    it("correctly analyzes ctx logs and aggregates performance metrics", () => {
      const logDir = resolve(testRoot, ".ritsu");
      mkdirSync(logDir, { recursive: true });
      const logPath = getCtxPath(testRoot);

      const events = [
        { ts: "1", skill: "dev", status: "started", trace_id: "t1" },
        { ts: "2", skill: "dev", status: "done", trace_id: "t1", token_estimate: 100, duration_ms: 1000 },
        { ts: "3", skill: "dev", status: "started", trace_id: "t2" },
        { ts: "4", skill: "dev", status: "failed", trace_id: "t2", error: "Lint check failed", token_estimate: 200, duration_ms: 2000 },
      ];

      writeFileSync(logPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");

      const perf = analyzeSkillPerformance(testRoot, "dev");

      expect(perf.totalRuns).toBe(2);
      expect(perf.passRate).toBe(50);
      expect(perf.avgTokens).toBe(150);
      expect(perf.avgDuration).toBe(1500);
      expect(perf.topFailurePatterns).toEqual(["Lint check failed"]);
    });
  });

  describe("proposeSkillOptimization & validateSkillProposal", () => {
    const config: SkillOptConfig = {
      textualLearningRate: 4,
      validationThreshold: 5,
      rejectedEditBufferSize: 50,
      minSampleSize: 2, // low for test
    };

    it("parses LLM response and handles rejected edits buffer", async () => {
      const mockPerf = {
        skill: "dev",
        version: "1.0.0",
        totalRuns: 3,
        passRate: 33.3,
        avgTokens: 1000,
        avgDuration: 5000,
        topFailurePatterns: ["Timeout"],
        lastOptimized: "",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  proposed_skill: "Optimized skill content",
                  explanation_of_changes: "Fixed timeout by doing X",
                }),
              },
            },
          ],
        }),
      });
      globalThis.fetch = fetchMock;

      const proposal = await proposeSkillOptimization(
        testRoot,
        "dev",
        "Old skill content",
        mockPerf,
        config,
      );

      expect(proposal).not.toBeNull();
      expect(proposal?.proposal).toBe("Optimized skill content");
      expect(proposal?.changes).toBe("Fixed timeout by doing X");

      // Verify validation gate saves rejected edits on validation failure
      const evalMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  will_improve: false,
                  confidence_score: 40,
                  reasoning: "Not good",
                }),
              },
            },
          ],
        }),
      });
      globalThis.fetch = evalMock;

      const isValid = await validateSkillProposal(testRoot, mockPerf, proposal!, config);
      expect(isValid).toBe(false);

      // Verify it was added to rejected-edits.jsonl
      const rejPath = resolve(testRoot, ".ritsu", "skill-optimizer", "rejected-edits.jsonl");
      expect(existsSync(rejPath)).toBe(true);
      const content = readFileSync(rejPath, "utf-8");
      expect(content).toContain("Optimized skill content");
    });
  });
});
