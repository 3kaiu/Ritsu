import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { syncLoopInstructionsToIDE, syncArchitectureToIDERules } from "../src/ide-rules-sync.js";
import { writeFileSync, existsSync, readFileSync, rmSync, mkdirSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

describe("IDE Rules Sync", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-sync-rules-"));
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("should generate rules files and update AGENTS.md", () => {
    // Write a dummy AGENTS.md to start with
    const agentsPath = resolve(testRoot, "AGENTS.md");
    writeFileSync(agentsPath, "# Project Baseline: Ritsu v8.7.0\n", "utf-8");

    const result = syncLoopInstructionsToIDE(testRoot);
    expect(result).toBe(true);

    // Verify Cursor rule exists
    const cursorPath = resolve(testRoot, ".cursor/rules/ritsu-loop.mdc");
    expect(existsSync(cursorPath)).toBe(true);
    const cursorContent = readFileSync(cursorPath, "utf-8");
    expect(cursorContent).toContain("globs: \"*\"");
    expect(cursorContent).toContain("Ritsu Quality Gates & Autopilot Loop");

    // Verify Claude rule exists
    const claudePath = resolve(testRoot, ".claude/rules/ritsu-loop.md");
    expect(existsSync(claudePath)).toBe(true);
    const claudeContent = readFileSync(claudePath, "utf-8");
    expect(claudeContent).toContain("Ritsu Quality Gates & Autopilot Loop (Claude Code)");

    // Verify AGENTS.md is updated
    const agentsContent = readFileSync(agentsPath, "utf-8");
    expect(agentsContent).toContain("## AI Loop & Autopilot Guidelines");
    expect(agentsContent).toContain("Auto Quality Gates");
  });

  it("should trigger loop rules sync when syncArchitectureToIDERules is run", () => {
    const result = syncArchitectureToIDERules(testRoot, "dev");
    expect(result).toBe(true);

    // Should write both architecture context AND autopilot loop rules
    expect(existsSync(resolve(testRoot, ".cursor/rules/ritsu-arch.mdc"))).toBe(true);
    expect(existsSync(resolve(testRoot, ".cursor/rules/ritsu-loop.mdc"))).toBe(true);
    expect(existsSync(resolve(testRoot, ".claude/rules/ritsu-arch.md"))).toBe(true);
    expect(existsSync(resolve(testRoot, ".claude/rules/ritsu-loop.md"))).toBe(true);
  });
});
