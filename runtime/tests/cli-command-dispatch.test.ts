import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[\d+m/g, "");
}

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];

  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });

  return {
    get output(): string {
      return stripAnsi([...logs, ...errors].join("\n"));
    },
  };
}

function mockExitNoThrow() {
  return vi.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
}

function writeCtx(root: string, events: Array<Record<string, unknown>>): string {
  const ritsuDir = resolve(root, ".ritsu");
  mkdirSync(ritsuDir, { recursive: true });
  const ctxPath = resolve(ritsuDir, "ctx-2026-05.jsonl");
  writeFileSync(
    ctxPath,
    events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    "utf-8",
  );
  return ctxPath;
}

function initGitRepo(root: string): void {
  execSync("git init", { cwd: root, stdio: "ignore" });
  execSync("git config user.email 'test@example.com'", { cwd: root, stdio: "ignore" });
  execSync("git config user.name 'Test User'", { cwd: root, stdio: "ignore" });
  writeFileSync(join(root, "README.md"), "# Test Repo\n", "utf-8");
  execSync("git add README.md", { cwd: root, stdio: "ignore" });
  execSync("git commit -m 'init'", { cwd: root, stdio: "ignore" });
}

async function runMain(args: string[]): Promise<void> {
  process.argv = ["node", "cli.js", ...args];
  main();
  await Promise.resolve();
}

describe("cli main command dispatch", () => {
  let testRoot: string;
  let originalArgv: string[];
  let originalProjectRoot: string | undefined;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-cli-dispatch-"));
    originalArgv = [...process.argv];
    originalProjectRoot = process.env.RITSU_PROJECT_ROOT;
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    process.argv = originalArgv;
    if (originalProjectRoot === undefined) {
      delete process.env.RITSU_PROJECT_ROOT;
    } else {
      process.env.RITSU_PROJECT_ROOT = originalProjectRoot;
    }
    vi.restoreAllMocks();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("dispatches doctor health mode from main()", async () => {
    const output = captureConsole();

    await runMain(["doctor", "--health"]);

    expect(output.output).toContain("Ritsu Health Dashboard");
    expect(output.output).toContain("No context file found");
  });

  it("dispatches export from main() and prints markdown to stdout", async () => {
    const output = captureConsole();
    writeCtx(testRoot, [
      {
        ts: "20260519-100000",
        correlation_id: "cid-1",
        skill: "dev",
        domain: "backend",
        status: "failed",
      },
      {
        ts: "20260519-100100",
        correlation_id: "cid-2",
        skill: "review",
        domain: "frontend",
        status: "started",
      },
    ]);

    await runMain(["export"]);

    expect(output.output).toContain("# Ritsu Task Export");
    expect(output.output).toContain("❌ failed");
    expect(output.output).toContain("⏳ in_progress");
  });

  it("dispatches export --out from main() and writes the report file", async () => {
    const output = captureConsole();
    writeCtx(testRoot, [
      {
        ts: "20260519-100000",
        correlation_id: "cid-1",
        skill: "think",
        domain: "fullstack",
        status: "done",
      },
    ]);

    await runMain(["export", "--out", "report.md"]);

    expect(output.output).toContain("Exported to: report.md");
    expect(readFileSync(resolve(testRoot, "report.md"), "utf-8")).toContain(
      "# Ritsu Task Export",
    );
  });

  it("dispatches trace --open from main()", async () => {
    const output = captureConsole();
    writeCtx(testRoot, [
      {
        ts: "20260519-100000",
        correlation_id: "cid-1",
        trace_id: "trace-open",
        span_kind: "root",
        skill: "dev",
        domain: "fullstack",
        status: "started",
      },
    ]);

    await runMain(["trace", "--open"]);

    expect(output.output).toContain("Open Traces:");
    expect(output.output).toContain("trace-open");
  });

  it("dispatches trace id and --check-triple from main()", async () => {
    const output = captureConsole();
    writeCtx(testRoot, [
      {
        ts: "20260519-100000",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        span_id: "span-root",
        skill: "think",
        domain: "fullstack",
        status: "started",
      },
      {
        ts: "20260519-100050",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        span_id: "span-root",
        skill: "think",
        domain: "fullstack",
        status: "artifact_written",
        artifact: "design-sheet-demo.md",
        artifact_meta: { type: "design-sheet" },
      },
      {
        ts: "20260519-100060",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        span_id: "span-child",
        parent_span_id: "span-root",
        skill: "dev",
        domain: "fullstack",
        status: "artifact_written",
        artifact_meta: { type: "dev-report" },
      },
      {
        ts: "20260519-100070",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        span_id: "span-grandchild",
        parent_span_id: "span-child",
        skill: "qa",
        domain: "fullstack",
        status: "artifact_written",
        artifact_meta: { type: "assurance-sheet" },
      },
      {
        ts: "20260519-100100",
        correlation_id: "cid-1",
        trace_id: "trace-1",
        span_id: "span-root",
        skill: "think",
        domain: "fullstack",
        status: "done",
        cost: { duration_ms: 15 },
      },
    ]);

    await runMain(["trace", "trace-1"]);
    expect(output.output).toContain("Trace ID: trace-1");
    expect(output.output).toContain("qa");

    await runMain(["trace", "--check-triple"]);
    expect(output.output).toContain("Triple Verification Passed!");
  });

  it("dispatches sync push/pull and unknown action from main()", async () => {
    const output = captureConsole();
    initGitRepo(testRoot);
    const ritsuDir = resolve(testRoot, ".ritsu");
    mkdirSync(ritsuDir, { recursive: true });
    writeFileSync(resolve(ritsuDir, "test.txt"), "hello sync", "utf-8");

    await runMain(["sync", "push"]);
    expect(output.output).toContain("Sync push successful.");

    rmSync(ritsuDir, { recursive: true, force: true });
    await runMain(["sync", "pull"]);
    expect(output.output).toContain("Sync pull successful.");
    expect(readFileSync(resolve(ritsuDir, "test.txt"), "utf-8")).toBe("hello sync");

    const exitSpy = mockExitNoThrow();
    await runMain(["sync", "bogus"]);
    expect(output.output).toContain("Unknown sync action: bogus");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("dispatches sync failure branches from main()", async () => {
    const output = captureConsole();

    await runMain(["sync", "push"]);
    await runMain(["sync", "pull"]);

    expect(output.output).toContain("Sync push failed.");
    expect(output.output).toContain("Sync pull failed.");
  });

  it("dispatches mine report, usage, promote success, and promote failure from main()", async () => {
    const output = captureConsole();
    const exitSpy = mockExitNoThrow();
    initGitRepo(testRoot);

    const codeFile = join(testRoot, "index.ts");
    writeFileSync(codeFile, "console.log('hello');", "utf-8");
    execSync("git add index.ts", { cwd: testRoot, stdio: "ignore" });
    execSync("git commit -m 'feat: AI commit'", { cwd: testRoot, stdio: "ignore" });

    const ts = new Date(Date.now() - 60_000)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .slice(0, 15);
    writeCtx(testRoot, [
      {
        ts,
        status: "artifact_written",
        artifact: "index.ts",
      },
      {
        ts,
        status: "violation_detected",
        violation: {
          rule_id: "AP-1",
          severity: "fatal",
          evidence: "index.ts",
        },
        skill: "dev",
        message: "violation",
      },
    ]);

    writeFileSync(codeFile, "logger.info('hello');\n", "utf-8");

    await runMain(["mine", "--report", "--days", "7"]);
    expect(output.output).toContain("Mining Sheet generated successfully!");
    expect(output.output).toContain("Scanning past 7 days");

    const miningSheet = readFileSync(
      resolve(
        testRoot,
        ".ritsu",
        `mining-sheet-${new Date().toISOString().slice(0, 10)}.md`,
      ),
      "utf-8",
    );
    expect(miningSheet).toContain("pref-unique-id");

    await runMain(["mine", "--days", "3"]);
    expect(output.output).toContain("ritsu cat");

    await runMain(["mine", "--promote", "pref-unique-id"]);
    expect(output.output).toContain(
      "Preference pref-unique-id promoted successfully to .ritsu/preferences.yaml",
    );
    expect(readFileSync(resolve(testRoot, ".ritsu/preferences.yaml"), "utf-8")).toContain(
      "id: pref-unique-id",
    );
    expect(readFileSync(resolve(testRoot, ".ritsu/preferences.yaml"), "utf-8")).toContain(
      "rules:",
    );

    await runMain(["mine", "--promote", "pref-missing"]);
    expect(output.output).toContain(
      "Failed to find proposal for pref-missing in recent mining sheets.",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("dispatches the no-results mine branch from main()", async () => {
    const output = captureConsole();

    await runMain(["mine", "--report"]);

    expect(output.output).toContain("No human corrections or violations found.");
  });
});
