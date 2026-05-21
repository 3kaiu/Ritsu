import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("llm-synthesizer", () => {
  // ─── getConfig ────────────────────────────────────────────

  describe("getConfig", () => {
    beforeEach(() => {
      process.env.RITSU_LLM_ENABLED = "0";
      delete process.env.RITSU_LLM_API_KEY;
      delete process.env.RITSU_LLM_ENDPOINT;
      delete process.env.RITSU_LLM_MODEL;
    });

    it("returns disabled config by default", async () => {
      const { getConfig } = await import("../src/llm-synthesizer.js");
      const cfg = getConfig();
      expect(cfg.enabled).toBe(false);
      expect(cfg.apiKey).toBe("");
      expect(cfg.endpoint).toBe("https://api.openai.com/v1/chat/completions");
      expect(cfg.model).toBe("gpt-4o-mini");
    });

    it("reads env vars", async () => {
      process.env.RITSU_LLM_ENABLED = "1";
      process.env.RITSU_LLM_API_KEY = "sk-test";
      process.env.RITSU_LLM_ENDPOINT = "https://custom.api.com/v1";
      process.env.RITSU_LLM_MODEL = "claude-sonnet-4";
      const { getConfig } = await import("../src/llm-synthesizer.js");
      const cfg = getConfig();
      expect(cfg.enabled).toBe(true);
      expect(cfg.apiKey).toBe("sk-test");
      expect(cfg.endpoint).toBe("https://custom.api.com/v1");
      expect(cfg.model).toBe("claude-sonnet-4");
    });
  });

  // ─── buildSynthesisPrompt ─────────────────────────────────

  describe("buildSynthesisPrompt", () => {
    it("builds prompt with corrections and violations", async () => {
      const { buildSynthesisPrompt } = await import("../src/llm-synthesizer.js");
      const prompt = buildSynthesisPrompt({
        corrections: [{ file: "src/a.ts", diff: "+console.log" }],
        violations: [{ rule_id: "AP-6", skill: "dev", message: "todo found", evidence: "TODO" }],
        existingRules: [{ id: "pref-auto-const", match_regex: "let ", scope: "coding_style", auto_inject_to: ["dev"], message: "use const" }],
      });
      expect(prompt).toContain("Human Corrections Analysis");
      expect(prompt).toContain("src/a.ts");
      expect(prompt).toContain("AP-6");
      expect(prompt).toContain("pref-auto-const");
      expect(prompt).toContain("Existing Rules Already Applied");
    });

    it("handles empty corrections", async () => {
      const { buildSynthesisPrompt } = await import("../src/llm-synthesizer.js");
      const prompt = buildSynthesisPrompt({ corrections: [], violations: [], existingRules: [] });
      expect(prompt).toContain("Human Corrections Analysis");
    });
  });

  // ─── parseLLMResponse ─────────────────────────────────────

  describe("parseLLMResponse", () => {
    it("parses valid YAML rules", async () => {
      const { parseLLMResponse } = await import("../src/llm-synthesizer.js");
      const yaml = `
- id: pref-no-console
  match_regex: "console\\\\.log"
  scope: coding_style
  auto_inject_to: [think, dev]
  message: "Use logger instead of console.log"`;
      const rules = parseLLMResponse(yaml);
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe("pref-no-console");
      expect(rules[0].match_regex).toBe("console\\.log");
    });

    it("parses YAML with markdown fences", async () => {
      const { parseLLMResponse } = await import("../src/llm-synthesizer.js");
      const content = "```yaml\n- id: pref-test\n  match_regex: test\n  scope: coding_style\n  auto_inject_to: [dev]\n  message: test\n```";
      const rules = parseLLMResponse(content);
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe("pref-test");
    });

    it("filters out invalid rules", async () => {
      const { parseLLMResponse } = await import("../src/llm-synthesizer.js");
      const yaml = `
- id: valid-rule
  match_regex: pattern
  scope: coding_style
  auto_inject_to: [dev]
  message: ok
- invalid: no_id_field`;
      const rules = parseLLMResponse(yaml);
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe("valid-rule");
    });

    it("returns empty array for invalid YAML", async () => {
      const { parseLLMResponse } = await import("../src/llm-synthesizer.js");
      const rules = parseLLMResponse("not: yaml: [[[");
      expect(rules).toEqual([]);
    });

    it("returns empty array for empty content", async () => {
      const { parseLLMResponse } = await import("../src/llm-synthesizer.js");
      expect(parseLLMResponse("")).toEqual([]);
    });
  });

  // ─── synthesizeWithLLM (integration) ──────────────────────

  describe("synthesizeWithLLM", () => {
    beforeEach(() => {
      process.env.RITSU_LLM_ENABLED = "0";
      delete process.env.RITSU_LLM_API_KEY;
    });

    it("returns empty when LLM disabled", async () => {
      const { synthesizeWithLLM } = await import("../src/llm-synthesizer.js");
      const result = await synthesizeWithLLM({ corrections: [], violations: [], existingRules: [] });
      expect(result).toEqual([]);
    });

    it("returns empty when no API key", async () => {
      process.env.RITSU_LLM_ENABLED = "1";
      const { synthesizeWithLLM } = await import("../src/llm-synthesizer.js");
      const result = await synthesizeWithLLM({ corrections: [], violations: [], existingRules: [] });
      expect(result).toEqual([]);
    });
  });
});
