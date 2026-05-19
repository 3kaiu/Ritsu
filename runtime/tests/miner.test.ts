import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { minePreferences, promotePreference } from "../src/miner.js";
import { existsSync, rmSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

function formatRitsuTs(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

describe("ritsu mine", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-miner-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;

    // init git repo
    execSync("git init", { cwd: testRoot, stdio: "ignore" });
    writeFileSync(join(testRoot, "README.md"), "# Test Repo");
    execSync("git add README.md", { cwd: testRoot, stdio: "ignore" });
    execSync("git config user.email 'test@example.com'", { cwd: testRoot, stdio: "ignore" });
    execSync("git config user.name 'Test'", { cwd: testRoot, stdio: "ignore" });
    execSync("git commit -m 'init'", { cwd: testRoot, stdio: "ignore" });
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("should generate a mining sheet when human overrides AI artifacts", () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir);

    const codeFile = join(testRoot, "index.ts");
    // 1. AI writes file
    writeFileSync(codeFile, "console.log('hello');");
    execSync("git add index.ts", { cwd: testRoot, stdio: "ignore" });
    execSync("git commit -m 'feat: AI commit'", { cwd: testRoot, stdio: "ignore" });

    // AI records the write event just before the commit
    const ts = formatRitsuTs(new Date(Date.now() - 1000 * 60));
    const ctxFile = join(ritsuDir, "ctx-20260515.jsonl");
    const event = { ts, status: "artifact_written", artifact: "index.ts" };
    writeFileSync(ctxFile, JSON.stringify(event) + "\n");

    // 2. Human overrides file
    writeFileSync(codeFile, "logger.info('hello');");
    execSync("git add index.ts", { cwd: testRoot, stdio: "ignore" });
    execSync("git commit -m 'fix: human override'", { cwd: testRoot, stdio: "ignore" });

    // Run miner
    const sheetPath = minePreferences(7);
    expect(sheetPath).toBeTruthy();
    expect(existsSync(sheetPath!)).toBe(true);

    const sheetContent = readFileSync(sheetPath!, "utf-8");
    expect(sheetContent).toContain("logger.info('hello');");
    expect(sheetContent).toContain("-console.log('hello');");
  });

  it("should return null if no corrections are found", () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir);

    const codeFile = join(testRoot, "index.ts");
    // 1. AI writes file
    writeFileSync(codeFile, "console.log('hello');");
    
    // AI records the write event
    const ts = formatRitsuTs(new Date());
    const ctxFile = join(ritsuDir, "ctx-20260515.jsonl");
    const event = { ts, status: "artifact_written", artifact: "index.ts" };
    writeFileSync(ctxFile, JSON.stringify(event) + "\n");

    // No human override...
    
    // Run miner
    const sheetPath = minePreferences(7);
    expect(sheetPath).toBeNull();
  });

  it("should include policy violations even when no human corrections are found", () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir);

    const nowTs = formatRitsuTs(new Date());
    const oldTs = formatRitsuTs(new Date(Date.now() - 10 * 24 * 3600 * 1000));
    const ctxFile = join(ritsuDir, "ctx-20260515.jsonl");
    writeFileSync(
      ctxFile,
      [
        JSON.stringify({
          ts: oldTs,
          status: "violation_detected",
          violation: {
            rule_id: "AP-OLD",
            severity: "error",
            evidence: "old.ts",
          },
          skill: "dev",
          message: "old violation",
        }),
        JSON.stringify({
          ts: nowTs,
          status: "violation_detected",
          violation: {
            rule_id: "AP-NEW",
            severity: "fatal",
            evidence: "src/app.ts",
          },
          skill: "review",
          message: "new violation",
        }),
        JSON.stringify({
          status: "violation_detected",
          violation: {
            rule_id: "AP-NO-TS",
            severity: "warn",
          },
        }),
        "{broken",
      ].join("\n") + "\n",
      "utf-8",
    );

    const sheetPath = minePreferences(7);
    expect(sheetPath).toBeTruthy();

    const sheetContent = readFileSync(sheetPath!, "utf-8");
    expect(sheetContent).toContain("## Section 2: Policy Violations");
    expect(sheetContent).toContain("AP-NEW");
    expect(sheetContent).toContain("new violation");
    expect(sheetContent).not.toContain("AP-OLD");
  });

  it("should include uncommitted working tree changes in the mining sheet", () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir);

    const codeFile = join(testRoot, "index.ts");
    writeFileSync(codeFile, "console.log('hello');");
    execSync("git add index.ts", { cwd: testRoot, stdio: "ignore" });
    execSync("git commit -m 'feat: AI commit'", { cwd: testRoot, stdio: "ignore" });

    const ts = formatRitsuTs(new Date(Date.now() - 1000 * 60));
    const ctxFile = join(ritsuDir, "ctx-20260515.jsonl");
    writeFileSync(
      ctxFile,
      JSON.stringify({ ts, status: "artifact_written", artifact: "index.ts" }) + "\n",
    );

    writeFileSync(codeFile, "logger.info('hello');\n");

    const sheetPath = minePreferences(7);
    expect(sheetPath).toBeTruthy();

    const sheetContent = readFileSync(sheetPath!, "utf-8");
    expect(sheetContent).toContain("[Uncommitted Working Tree Changes]");
    expect(sheetContent).toContain("+logger.info('hello');");
  });

  it("should promote preferences from the most recent mining sheet", () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir);

    writeFileSync(
      join(ritsuDir, "mining-sheet-2026-05-01.md"),
      [
        "```yaml",
        "- id: pref-old",
        "  match_regex: \"old\"",
        "```",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(ritsuDir, "mining-sheet-2026-05-02.md"),
      [
        "```yaml",
        "- id: pref-new",
        "  match_regex: \"new\"",
        "```",
      ].join("\n"),
      "utf-8",
    );

    expect(promotePreference("pref-new")).toBe(true);

    const prefs = readFileSync(join(ritsuDir, "preferences.yaml"), "utf-8");
    expect(prefs).toContain("rules:");
    expect(prefs).toContain("id: pref-new");
    expect(prefs).not.toContain("id: pref-old");
  });

  it("should upgrade legacy preferences roots, avoid duplicates, and return false when missing", () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir);

    writeFileSync(
      join(ritsuDir, "mining-sheet-2026-05-02.md"),
      [
        "```yaml",
        "- id: pref-new",
        "  match_regex: \"new\"",
        "```",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(ritsuDir, "preferences.yaml"),
      [
        "preferences:",
        "- id: pref-new",
        "  match_regex: \"new\"",
      ].join("\n"),
      "utf-8",
    );

    expect(promotePreference("pref-new")).toBe(true);
    expect(promotePreference("pref-missing")).toBe(false);

    const prefs = readFileSync(join(ritsuDir, "preferences.yaml"), "utf-8");
    expect(prefs).toContain("rules:");
    expect(prefs).not.toContain("preferences:");
    expect((prefs.match(/id: pref-new/g) ?? []).length).toBe(1);
  });

  it("should return false when no mining sheets exist", () => {
    const ritsuDir = join(testRoot, ".ritsu");
    mkdirSync(ritsuDir);

    expect(promotePreference("pref-none")).toBe(false);
  });
});
