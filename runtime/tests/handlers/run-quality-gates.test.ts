import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as child_process from "node:child_process";
import * as gitUtils from "../../src/handlers/_git-utils.js";
import { EventEmitter } from "node:events";
import { ritsu_run_quality_gates } from "../../src/handlers/run-quality-gates.js";

vi.mock("node:child_process");
vi.mock("../../src/handlers/_git-utils.js");

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function completeChild(
  child: MockChild,
  code: number,
  stdout = "",
  stderr = "",
  delayMs = 0,
): void {
  setTimeout(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout, "utf-8"));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr, "utf-8"));
    child.emit("close", code);
  }, delayMs);
}

function errorChild(child: MockChild, message: string, delayMs = 0): void {
  setTimeout(() => {
    child.emit("error", new Error(message));
  }, delayMs);
}

function mockSpawnSequence(...plans: Array<(child: MockChild) => void>): void {
  vi.mocked(child_process.spawn).mockImplementation(() => {
    const plan = plans.shift();
    if (!plan) {
      throw new Error("unexpected spawn invocation");
    }
    const child = createMockChild();
    plan(child);
    return child as any;
  });
}

function mockNoGitWorktree(): void {
  vi.mocked(gitUtils.runGit).mockImplementation(async (args) => {
    if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
      return { ok: false, output: "fatal: not a git repo" };
    }
    return { ok: false, output: `unexpected git args: ${args.join(" ")}` };
  });
}

function mockGitWorktreeState(overrides?: {
  head?: string;
  stagedFiles?: string[];
  unstagedFiles?: string[];
  stagedPatch?: string;
  unstagedPatch?: string;
  untrackedFiles?: string[];
}): void {
  vi.mocked(gitUtils.runGit).mockImplementation(async (args) => {
    const cmd = args.join(" ");
    switch (cmd) {
      case "rev-parse --is-inside-work-tree":
        return { ok: true, output: "true" };
      case "rev-parse --verify HEAD":
        return { ok: true, output: overrides?.head ?? "abc123" };
      case "diff --name-only --cached --no-ext-diff -- . :(exclude).ritsu/**":
        return { ok: true, output: (overrides?.stagedFiles ?? []).join("\n") };
      case "diff --name-only --no-ext-diff -- . :(exclude).ritsu/**":
        return { ok: true, output: (overrides?.unstagedFiles ?? []).join("\n") };
      case "diff --binary --cached --no-ext-diff -- . :(exclude).ritsu/**":
        return { ok: true, output: overrides?.stagedPatch ?? "" };
      case "diff --binary --no-ext-diff -- . :(exclude).ritsu/**":
        return { ok: true, output: overrides?.unstagedPatch ?? "" };
      case "ls-files --others --exclude-standard -- . :(exclude).ritsu/**":
        return { ok: true, output: (overrides?.untrackedFiles ?? []).join("\n") };
      default:
        return { ok: false, output: `unexpected git args: ${cmd}` };
    }
  });
}

describe("ritsu_run_quality_gates", () => {
  const root = resolve("./test-root-qg");

  beforeEach(() => {
    process.env.RITSU_PROJECT_ROOT = root;
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    vi.clearAllMocks();
    mockNoGitWorktree();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports success when lint and test pass", async () => {
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint", test: "vitest" } }),
    );

    mockSpawnSequence(
      (child) => completeChild(child, 0, "lint ok"),
      (child) => completeChild(child, 0, "All tests passed"),
    );

    const result = await ritsu_run_quality_gates({ timeout_ms: 1000 });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.passed).toBe(true);
    expect(data.status).toBe("passed");
    expect(data.lint.status).toBe("passed");
    expect(data.test.status).toBe("passed");
  });

  it("reports failure when tests fail with explicit FAIL output", async () => {
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({ scripts: { test: "vitest" } }),
    );

    mockSpawnSequence((child) =>
      completeChild(child, 1, "FAIL tests/main.test.ts\n✕ should work", "Error: failed"),
    );

    const result = await ritsu_run_quality_gates({ skip_lint: true, timeout_ms: 1000 });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.passed).toBe(false);
    expect(data.test.status).toBe("failed");
    expect(data.test.failures).toHaveLength(1);
    expect(data.test.failures[0].suite).toContain("tests/main.test.ts");
  });

  it("fails strictly when lint and test commands are missing", async () => {
    const result = await ritsu_run_quality_gates({ strict: true, timeout_ms: 1000 });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.passed).toBe(false);
    expect(data.status).toBe("failed");
    expect(data.lint).toEqual({
      status: "failed",
      output: "no lint command found",
    });
    expect(data.test).toEqual({
      status: "failed",
      failures: [],
      output: "no test command found",
    });
    expect(child_process.spawn).not.toHaveBeenCalled();
  });

  it("returns partially skipped when commands are missing outside strict mode", async () => {
    const result = await ritsu_run_quality_gates({ timeout_ms: 1000 });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.passed).toBe(false);
    expect(data.status).toBe("partially_skipped");
    expect(data.lint.status).toBe("skipped");
    expect(data.test.status).toBe("skipped");
  });

  it("parses AGENTS.md commands, finds prefixed coverage, and persists a snapshot", async () => {
    mkdirSync(resolve(root, "runtime/coverage"), { recursive: true });
    writeFileSync(
      resolve(root, "AGENTS.md"),
      [
        "lint_cmd: npm --prefix runtime run lint",
        "test_cmd: npm --prefix runtime run test:coverage",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      resolve(root, "runtime/coverage/coverage-summary.json"),
      JSON.stringify({
        total: {
          lines: { pct: 87.5, covered: 7, total: 8 },
          statements: { pct: 80, covered: 8, total: 10 },
        },
        [`${root}/runtime/src/main.ts`]: {
          lines: { pct: 87.5, covered: 7, total: 8 },
        },
        ignored: "not-a-coverage-entry",
      }),
      "utf-8",
    );

    mockSpawnSequence(
      (child) => completeChild(child, 0, "lint ok"),
      (child) => completeChild(child, 0, "tests ok"),
    );

    const result = await ritsu_run_quality_gates({ timeout_ms: 1000 });
    const data = JSON.parse(result.content[0].text as string);
    const persisted = JSON.parse(
      readFileSync(resolve(root, ".ritsu/last-quality-gate.json"), "utf-8"),
    );

    expect(vi.mocked(child_process.spawn)).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["--prefix", "runtime", "run", "lint"],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(vi.mocked(child_process.spawn)).toHaveBeenNthCalledWith(
      2,
      "npm",
      ["--prefix", "runtime", "run", "test:coverage"],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(data.coverage.summary.lines.pct).toBe(87.5);
    expect(data.coverage.per_file["runtime/src/main.ts"].lines.pct).toBe(87.5);
    expect(data.coverage.per_file.ignored).toBeUndefined();
    expect(persisted.status).toBe("passed");
    expect(persisted.passed).toBe(true);
    expect(persisted.recorded_at).toMatch(/^\d{8}-\d{6}$/);
    expect(persisted.coverage.total).toEqual(persisted.coverage.summary);
  });

  it("persists execution context when quality gates run inside a trace/span", async () => {
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint", test: "vitest" } }),
    );

    mockSpawnSequence(
      (child) => completeChild(child, 0, "lint ok"),
      (child) => completeChild(child, 0, "tests ok"),
    );

    await ritsu_run_quality_gates({
      timeout_ms: 1000,
      correlation_id: "cid-20260519-9",
      trace_id: "trace-20260519-0000000000000009",
      span_id: "span-deadbeef",
      skill: "dev",
      domain: "fullstack",
    });

    const persisted = JSON.parse(
      readFileSync(resolve(root, ".ritsu/last-quality-gate.json"), "utf-8"),
    );

    expect(persisted.context).toEqual({
      correlation_id: "cid-20260519-9",
      trace_id: "trace-20260519-0000000000000009",
      span_id: "span-deadbeef",
      skill: "dev",
      domain: "fullstack",
    });
  });

  it("persists a worktree fingerprint for freshness validation", async () => {
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint", test: "vitest" } }),
    );
    mockGitWorktreeState({
      head: "deadbeef",
      stagedFiles: ["src/main.ts"],
      unstagedFiles: ["README.md"],
      stagedPatch: "cached patch",
      unstagedPatch: "working tree patch",
    });

    mockSpawnSequence(
      (child) => completeChild(child, 0, "lint ok"),
      (child) => completeChild(child, 0, "tests ok"),
    );

    await ritsu_run_quality_gates({ timeout_ms: 1000 });
    const persisted = JSON.parse(
      readFileSync(resolve(root, ".ritsu/last-quality-gate.json"), "utf-8"),
    );

    expect(persisted.worktree).toMatchObject({
      head: "deadbeef",
      staged: {
        files: ["src/main.ts"],
      },
      unstaged: {
        files: ["README.md"],
      },
      untracked: {
        files: [],
      },
    });
    expect(persisted.worktree.staged.patch_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.worktree.unstaged.patch_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.worktree.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("falls back to file-based error parsing when test output lacks FAIL markers", async () => {
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({ scripts: { test: "vitest" } }),
    );

    mockSpawnSequence((child) =>
      completeChild(child, 1, "Expected truthy value in src/example.test.ts:12:2"),
    );

    const result = await ritsu_run_quality_gates({ skip_lint: true, timeout_ms: 1000 });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.test.status).toBe("failed");
    expect(data.test.failures).toHaveLength(1);
    expect(data.test.failures[0]).toMatchObject({
      suite: "src/example.test.ts:12:2",
      test: "",
      file_hint: "src/example.test.ts:12:2",
    });
    expect(data.test.failures[0].error).toContain("Expected truthy value");
  });

  it("times out stuck commands and terminates the child process", async () => {
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({ scripts: { test: "vitest" } }),
    );

    let timedOutChild: MockChild | undefined;
    mockSpawnSequence((child) => {
      timedOutChild = child;
    });

    const result = await ritsu_run_quality_gates({ skip_lint: true, timeout_ms: 5 });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.test.status).toBe("failed");
    expect(data.test.output).toBe("timeout");
    expect(timedOutChild?.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("reports spawn errors and ignores invalid coverage summaries", async () => {
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({ scripts: { "test:coverage": "vitest --coverage" } }),
    );
    mkdirSync(resolve(root, "coverage"), { recursive: true });
    writeFileSync(resolve(root, "coverage/coverage-summary.json"), "{bad json", "utf-8");

    mockSpawnSequence((child) => errorChild(child, "spawn failed"));

    const result = await ritsu_run_quality_gates({ skip_lint: true, timeout_ms: 1000 });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.test.status).toBe("failed");
    expect(data.test.output).toBe("spawn failed");
    expect(data.coverage).toBeUndefined();
  });

  it("caches and correctly invalidates Vitest coverage summary reads when mtimeMs changes", async () => {
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({ scripts: { "test:coverage": "vitest --coverage" } }),
    );
    mkdirSync(resolve(root, "coverage"), { recursive: true });

    const covPath = resolve(root, "coverage/coverage-summary.json");

    // 1. Write 50% coverage
    writeFileSync(
      covPath,
      JSON.stringify({
        total: {
          lines: { pct: 50.0, covered: 5, total: 10 },
        },
      }),
      "utf-8",
    );

    mockSpawnSequence((child) => completeChild(child, 0, "tests ok"));
    let result = await ritsu_run_quality_gates({ skip_lint: true, timeout_ms: 1000 });
    let data = JSON.parse(result.content[0].text as string);
    expect(data.coverage.summary.lines.pct).toBe(50.0);

    // 2. Overwrite with 90% coverage
    writeFileSync(
      covPath,
      JSON.stringify({
        total: {
          lines: { pct: 90.0, covered: 9, total: 10 },
        },
      }),
      "utf-8",
    );

    mockSpawnSequence((child) => completeChild(child, 0, "tests ok"));
    result = await ritsu_run_quality_gates({ skip_lint: true, timeout_ms: 1000 });
    data = JSON.parse(result.content[0].text as string);
    expect(data.coverage.summary.lines.pct).toBe(90.0);
  });

  it("parses Python coverage.json format correctly", async () => {
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({ scripts: { "test:coverage": "pytest" } }),
    );
    writeFileSync(
      resolve(root, "coverage.json"),
      JSON.stringify({
        totals: {
          percent_covered: 75.0,
          covered_lines: 75,
          num_statements: 100,
        },
        files: {
          "src/module.py": {
            summary: {
              percent_covered: 75.0,
              covered_lines: 75,
              num_statements: 100,
            }
          }
        }
      }),
      "utf-8",
    );

    mockSpawnSequence((child) => completeChild(child, 0, "pytest ok"));

    const result = await ritsu_run_quality_gates({ skip_lint: true, timeout_ms: 1000 });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.coverage.summary.lines.pct).toBe(75.0);
    expect(data.coverage.summary.statements.pct).toBe(75.0);
    expect(data.coverage.per_file["src/module.py"].lines.pct).toBe(75.0);
  });

  it("parses Python coverage.xml format correctly", async () => {
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({ scripts: { "test:coverage": "pytest" } }),
    );
    writeFileSync(
      resolve(root, "coverage.xml"),
      `<?xml version="1.0" ?>
<coverage line-rate="0.80" lines-valid="100" lines-covered="80" branch-rate="0.70">
  <sources>
    <source>/src</source>
  </sources>
  <packages>
    <package name="src">
      <classes>
        <class name="module.py" filename="src/module.py" line-rate="0.80">
        </class>
      </classes>
    </package>
  </packages>
</coverage>`,
      "utf-8",
    );

    mockSpawnSequence((child) => completeChild(child, 0, "pytest xml ok"));

    const result = await ritsu_run_quality_gates({ skip_lint: true, timeout_ms: 1000 });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.coverage.summary.lines.pct).toBe(80.0);
    expect(data.coverage.summary.lines.total).toBe(100);
    expect(data.coverage.summary.lines.covered).toBe(80);
    expect(data.coverage.summary.branches.pct).toBe(70.0);
    expect(data.coverage.per_file["src/module.py"].lines.pct).toBe(80.0);
  });

  it("parses Go cover.out format correctly", async () => {
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({ scripts: { "test:coverage": "go test" } }),
    );
    writeFileSync(
      resolve(root, "cover.out"),
      `mode: set
github.com/user/project/file1.go:1.10,5.20 2 1
github.com/user/project/file1.go:6.10,10.20 3 0
github.com/user/project/file2.go:1.10,5.20 5 2`,
      "utf-8",
    );

    mockSpawnSequence((child) => completeChild(child, 0, "go test ok"));

    const result = await ritsu_run_quality_gates({ skip_lint: true, timeout_ms: 1000 });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.coverage.summary.lines.pct).toBe(70.0);
    expect(data.coverage.summary.lines.total).toBe(10);
    expect(data.coverage.summary.lines.covered).toBe(7);

    expect(data.coverage.per_file["github.com/user/project/file1.go"].lines.pct).toBe(40.0);
    expect(data.coverage.per_file["github.com/user/project/file2.go"].lines.pct).toBe(100.0);
  });

  it("detects Vitest and Jest runners correctly from commands and package.json", async () => {
    const { detectTestRunner } = await import("../../src/handlers/run-quality-gates.js");
    
    // Direct command detection
    expect(detectTestRunner({ binary: "vitest", args: ["run"], cwd: root })).toBe("vitest");
    expect(detectTestRunner({ binary: "jest", args: [], cwd: root })).toBe("jest");
    expect(detectTestRunner({ binary: "bun", args: ["test"], cwd: root })).toBe("vitest");

    // Package.json detection
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({
        scripts: {
          "test:coverage": "vitest run --coverage",
          "test:jest": "jest --config jest.config.js"
        }
      })
    );
    expect(detectTestRunner({ binary: "npm", args: ["run", "test:coverage"], cwd: root })).toBe("vitest");
    expect(detectTestRunner({ binary: "npm", args: ["run", "test:jest"], cwd: root })).toBe("jest");
    expect(detectTestRunner({ binary: "npm", args: ["run", "other"], cwd: root })).toBeNull();
  });

  it("injects reporter arguments with package manager double-dash handling", async () => {
    const { injectReporterArgs } = await import("../../src/handlers/run-quality-gates.js");

    // Direct execution
    expect(injectReporterArgs("vitest", ["run"], "vitest", "/path/to/report.json"))
      .toEqual(["run", "--reporter=json", "--outputFile", "/path/to/report.json"]);

    // Package manager double-dash injection
    expect(injectReporterArgs("npm", ["run", "test"], "vitest", "/path/to/report.json"))
      .toEqual(["run", "test", "--", "--reporter=json", "--outputFile", "/path/to/report.json"]);

    expect(injectReporterArgs("npm", ["run", "test", "--", "--passWithNoTests"], "vitest", "/path/to/report.json"))
      .toEqual(["run", "test", "--", "--reporter=json", "--outputFile", "/path/to/report.json", "--passWithNoTests"]);
  });

  it("parses failures correctly using mock Vitest JSON report", async () => {
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({ scripts: { test: "vitest" } }),
    );

    // Mock Vitest JSON report file creation when spawned
    vi.mocked(child_process.spawn).mockImplementation((binary, args, options) => {
      // Find the injected report file path from arguments
      const reportIdx = args.indexOf("--outputFile");
      if (reportIdx !== -1 && args[reportIdx + 1]) {
        const reportPath = args[reportIdx + 1];
        writeFileSync(
          reportPath,
          JSON.stringify({
            testResults: [
              {
                name: "src/sample.test.ts",
                status: "failed",
                assertionResults: [
                  {
                    fullName: "Suite Name > test case 1",
                    status: "failed",
                    failureMessages: ["AssertionError: expected true to be false"]
                  }
                ]
              }
            ]
          }),
          "utf-8"
        );
      }
      
      const child = createMockChild();
      completeChild(child, 1, "test failed in JSON report mode", "", 10);
      return child as any;
    });

    const result = await ritsu_run_quality_gates({ skip_lint: true, timeout_ms: 1000 });
    const data = JSON.parse(result.content[0].text as string);

    expect(data.passed).toBe(false);
    expect(data.test.status).toBe("failed");
    expect(data.test.failures).toHaveLength(1);
    expect(data.test.failures[0]).toEqual({
      suite: "src/sample.test.ts",
      test: "Suite Name > test case 1",
      error: "AssertionError: expected true to be false",
      file_hint: "src/sample.test.ts"
    });
  });
});
