import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { autoApplyMinedRules } from "../src/miner.js";
import { buildSynthesisPrompt, parseLLMResponse } from "../src/llm-synthesizer.js";
import { existsSync, rmSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import yaml from "js-yaml";

function formatRitsuTs(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

describe("Ritsu LLM-Driven Adaptive Learning Engine", () => {
  let testRoot: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-miner-adaptive-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;

    originalEnv = { ...process.env };
    process.env.RITSU_LLM_ENABLED = "1";
    process.env.RITSU_LLM_API_KEY = "mock-api-key";

    // Initialize git repo
    execSync("git init", { cwd: testRoot, stdio: "ignore" });
    writeFileSync(join(testRoot, "README.md"), "# Ritsu Test");
    execSync("git add README.md", { cwd: testRoot, stdio: "ignore" });
    execSync("git config user.email 'adaptive@ritsu.com'", { cwd: testRoot, stdio: "ignore" });
    execSync("git config user.name 'Adaptive Test'", { cwd: testRoot, stdio: "ignore" });
    execSync("git commit -m 'init'", { cwd: testRoot, stdio: "ignore" });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe("Prompt Synthesis & Parsing", () => {
    it("should correctly build the synthesis prompt from corrections and violations", () => {
      const input = {
        corrections: [{ file: "src/main.ts", diff: "modified lines diff" }],
        violations: [{ rule_id: "pref-no-any", skill: "dev", message: "avoid any", evidence: "x: any" }],
        existingRules: [{ id: "pref-existing", match_regex: "console\\.log", scope: "coding_style" }]
      };

      const prompt = buildSynthesisPrompt(input);
      expect(prompt).toContain("src/main.ts");
      expect(prompt).toContain("modified lines diff");
      expect(prompt).toContain("pref-no-any");
      expect(prompt).toContain("avoid any");
      expect(prompt).toContain("pref-existing");
    });

    it("should correctly parse clean and code-fenced YAML LLM responses", () => {
      const fencedResponse = `
\`\`\`yaml
- id: pref-no-console
  match_regex: "console\\\\.log"
  scope: coding_style
  auto_inject_to: [think, dev]
  message: "Use logger"
\`\`\`
      `;
      const rules = parseLLMResponse(fencedResponse);
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe("pref-no-console");
      expect(rules[0].match_regex).toBe("console\\.log");
      expect(rules[0].scope).toBe("coding_style");
    });
  });

  describe("End-to-End LLM Synthesis", () => {
    it("should call the mocked LLM, merge new rules, and compile them to ast-grep", async () => {
      const ritsuDir = join(testRoot, ".ritsu");
      mkdirSync(ritsuDir);

      // AI writes file
      const codeFile = join(testRoot, "index.ts");
      writeFileSync(codeFile, "console.log('AI write');\n");
      execSync("git add index.ts", { cwd: testRoot, stdio: "ignore" });
      execSync("git commit -m 'AI commit'", { cwd: testRoot, stdio: "ignore" });

      // Mock Event Trace
      const ts = formatRitsuTs(new Date(Date.now() - 1000 * 60));
      const ctxFile = join(ritsuDir, "ctx-20260521.jsonl");
      writeFileSync(
        ctxFile,
        JSON.stringify({ ts, status: "artifact_written", artifact: "index.ts" }) + "\n",
        "utf-8"
      );

      // Human overrides AI code
      writeFileSync(codeFile, "logger.info('AI write');\n");
      execSync("git add index.ts", { cwd: testRoot, stdio: "ignore" });
      execSync("git commit -m 'human override'", { cwd: testRoot, stdio: "ignore" });

      // Create existing preferences.yaml
      const prefFile = join(ritsuDir, "preferences.yaml");
      writeFileSync(
        prefFile,
        yaml.dump({
          rules: [
            {
              id: "pref-existing",
              match_regex: "some-regex",
              scope: "coding_style"
            }
          ]
        }),
        "utf-8"
      );

      // Mock the LLM fetch endpoint
      const mockLlmResponse = `
- id: pref-auto-logger
  match_regex: "console\\\\.log"
  scope: coding_style
  auto_inject_to: [think, dev]
  message: "Use project logger instead of console.log."
      `;

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: mockLlmResponse,
                },
              },
            ],
          }),
          { status: 200 }
        )
      );

      // Run auto-apply preference mining
      const result = await autoApplyMinedRules(7);

      expect(fetchSpy).toHaveBeenCalled();
      expect(result.addedCount).toBe(1);
      expect(result.rules).toHaveLength(1);
      expect(result.rules[0].id).toBe("pref-auto-logger");

      // Verify the preferences.yaml file is correctly updated and merged conflict-free
      const prefContent = readFileSync(prefFile, "utf-8");
      expect(prefContent).toContain("id: pref-existing");
      expect(prefContent).toContain("id: pref-auto-logger");

      // Verify it generated compiled ast-grep rules during reconciliation
      expect(existsSync(join(testRoot, "rules/ast-grep/pref-pref-auto-logger.yml"))).toBe(true);
    });
  });
});
