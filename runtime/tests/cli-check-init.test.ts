import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { runCheck } from "../src/cli/check.js";
import { main } from "../src/cli.js";
import { writeFileSync, mkdirSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// Mock variables to control spawnSync behavior
let mockSpawnSyncResult: any = { status: 0, stdout: "", stderr: "" };
let mockSpawnSyncFn: any = null;

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    spawnSync: vi.fn().mockImplementation((cmd: string, args: string[], opts: any) => {
      if (mockSpawnSyncFn) {
        return mockSpawnSyncFn(cmd, args, opts);
      }
      return mockSpawnSyncResult;
    }),
  };
});

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

function mockProcessExit() {
  return vi.spyOn(process, "exit").mockImplementation(
    ((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as typeof process.exit,
  );
}

describe("CLI check & init delegation", () => {
  let testRoot: string;
  let originalProjectRoot: string | undefined;
  let originalArgv: string[];

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-check-init-"));
    originalProjectRoot = process.env.RITSU_PROJECT_ROOT;
    process.env.RITSU_PROJECT_ROOT = testRoot;
    originalArgv = [...process.argv];
    mockSpawnSyncResult = { status: 0, stdout: "", stderr: "" };
    mockSpawnSyncFn = null;
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

  it("runCheck rejects non-staged invocation", () => {
    const output = captureConsole();
    mockProcessExit();

    expect(() => runCheck([])).toThrow("process.exit:1");
    expect(output.output).toContain("Only 'ritsu check --staged' is supported");
  });

  it("runCheck exits with 0 if no files are staged", () => {
    const output = captureConsole();
    mockProcessExit();

    mockSpawnSyncResult = {
      status: 0,
      stdout: "",
      stderr: "",
    };

    expect(() => runCheck(["--staged"])).toThrow("process.exit:0");
    expect(output.output).toContain("No staged files to check");
  });

  it("runCheck falls back to evaluatePolicies if native ritsud does not exist", () => {
    const output = captureConsole();
    mockProcessExit();

    // Mock git diff returning one file
    mockSpawnSyncResult = {
      status: 0,
      stdout: "src/domain/user.ts\n",
      stderr: "",
    };

    // Create the dummy file so existsSync passes
    const userPath = resolve(testRoot, "src/domain/user.ts");
    mkdirSync(join(testRoot, "src/domain"), { recursive: true });
    writeFileSync(userPath, "Co-authored-by: Claude\n", "utf-8");

    // runCheck should run JS policy checks and find an AP-9 violation (Attribution leak)
    expect(() => runCheck(["--staged"])).toThrow("process.exit:1");
    expect(output.output).toContain("Content matched restricted pattern");
  });

  it("runCheck delegates to native ritsud check if it exists", () => {
    const output = captureConsole();
    mockProcessExit();

    // Mock git diff and ritsud check calls
    mockSpawnSyncFn = (cmd: string) => {
      if (cmd === "git") {
        return {
          status: 0,
          stdout: "src/main.ts\n",
          stderr: "",
        };
      }
      if (cmd === resolve(testRoot, "ritsud/target/release/ritsud")) {
        return {
          status: 0,
          stdout: "All policy gates passed.",
          stderr: "",
        };
      }
      return { status: 1 };
    };

    // Create ritsud folder and dummy release binary
    const binDir = resolve(testRoot, "ritsud/target/release");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "ritsud"), "dummy binary content", "utf-8");

    // Create dummy staged file
    mkdirSync(join(testRoot, "src"), { recursive: true });
    writeFileSync(resolve(testRoot, "src/main.ts"), "console.log('test');", "utf-8");

    expect(() => runCheck(["--staged"])).toThrow("process.exit:0");
    expect(output.output).toContain("Delegating to native ritsud check");
  });

  it("ritsu init exits with 1 if native ritsud binary does not exist", async () => {
    const output = captureConsole();
    mockProcessExit();

    process.argv = ["node", "cli.js", "init"];
    expect(() => main()).toThrow("process.exit:1");
    expect(output.output).toContain("Native ritsud binary not found");
  });

  it("ritsu init delegates to native ritsud if it exists", async () => {
    const output = captureConsole();
    mockProcessExit();

    // Mock spawnSync for ritsud init
    mockSpawnSyncFn = (cmd: string) => {
      if (cmd === resolve(testRoot, "ritsud/target/release/ritsud")) {
        return {
          status: 0,
          stdout: "Hook installed successfully",
          stderr: "",
        };
      }
      return { status: 1 };
    };

    // Create ritsud folder and dummy release binary
    const binDir = resolve(testRoot, "ritsud/target/release");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "ritsud"), "dummy binary content", "utf-8");

    process.argv = ["node", "cli.js", "init"];
    expect(() => main()).toThrow("process.exit:0");
    expect(output.output).toContain("Delegating to native ritsud init");
  });
});
