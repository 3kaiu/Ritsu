import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { getProjectRoot, textResult } from "./_utils.js";

interface TestFailure {
  suite: string;
  test: string;
  error: string;
  file_hint: string;
}

interface QualityGateResult {
  lint: { status: "passed" | "failed" | "skipped"; output: string };
  test: {
    status: "passed" | "failed" | "skipped";
    failures: TestFailure[];
    output: string;
  };
}

function runCommand(
  binary: string,
  args: string[],
  cwd: string,
  timeoutMs = 60_000,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const maxBytes = 2 * 1024 * 1024;
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < maxBytes) stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < maxBytes) stderr += chunk.toString("utf-8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, output: stdout || stderr || "timeout" });
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const combined = (stdout + "\n" + stderr).trim();
      resolve({ ok: code === 0, output: combined });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, output: err.message });
    });
  });
}

function parseTestFailures(output: string): TestFailure[] {
  const failures: TestFailure[] = [];

  // vitest / jest pattern: FAIL <suite>
  // followed by: × <test> [duration] or ✕ <test>
  const lines = output.split("\n");
  let currentSuite = "";

  for (const line of lines) {
    const suiteMatch = line.match(/FAIL\s+(.+)/);
    if (suiteMatch) {
      currentSuite = suiteMatch[1].trim();
      continue;
    }

    const failMatch = line.match(/[✕✗×]\s+(.+?)(?:\s+\d+m?s)?/);
    if (failMatch && currentSuite) {
      failures.push({
        suite: currentSuite,
        test: failMatch[1].trim(),
        error: "",
        file_hint: currentSuite,
      });
    }
  }

  // Fallback: match "AssertionError" or "Expected" lines
  if (failures.length === 0) {
    for (const line of lines) {
      const errMatch = line.match(/(?:FAIL|Error|Expected).*?(\S+\.(?:test|spec)\.\S+)/);
      if (errMatch) {
        failures.push({
          suite: errMatch[1],
          test: "",
          error: line.trim(),
          file_hint: errMatch[1],
        });
      }
    }
  }

  return failures.slice(0, 20);
}

function parseAgentsMd(root: string): { lint_cmd: string; test_cmd: string } {
  const agentsPath = resolve(root, "AGENTS.md");
  let lint_cmd = "";
  let test_cmd = "";

  if (existsSync(agentsPath)) {
    const content = readFileSync(agentsPath, "utf-8");
    const lintMatch = content.match(/lint[_-]?cmd\s*[:=]\s*`?([^`\n]+)`?/i);
    const testMatch = content.match(/test[_-]?cmd\s*[:=]\s*`?([^`\n]+)`?/i);
    if (lintMatch) lint_cmd = lintMatch[1].trim();
    if (testMatch) test_cmd = testMatch[1].trim();
  }

  // Auto-detect from package.json if AGENTS.md has no commands
  const pkgPath = resolve(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const scripts = pkg.scripts ?? {};
      if (!lint_cmd && scripts.lint) lint_cmd = `npm run lint`;
      if (!test_cmd && scripts.test) test_cmd = `npm run test`;
    } catch {
      // ignore
    }
  }

  return { lint_cmd, test_cmd };
}

export async function ritsu_run_quality_gates(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const skipLint = params.skip_lint === true;
  const skipTest = params.skip_test === true;
  const strict = params.strict === true;
  const timeoutMs = Math.min(Number(params.timeout_ms ?? 60_000), 120_000);

  const { lint_cmd, test_cmd } = parseAgentsMd(root);

  const result: QualityGateResult = {
    lint: { status: "skipped", output: "" },
    test: { status: "skipped", failures: [], output: "" },
  };

  // Lint
  if (!skipLint && lint_cmd) {
    const parts = lint_cmd.split(/\s+/);
    const r = await runCommand(parts[0], parts.slice(1), root, timeoutMs);
    result.lint = { status: r.ok ? "passed" : "failed", output: r.output.slice(0, 2000) };
  } else if (!skipLint && !lint_cmd) {
    result.lint = { status: strict ? "failed" : "skipped", output: "no lint command found" };
  }

  // Test
  if (!skipTest && test_cmd) {
    const parts = test_cmd.split(/\s+/);
    const r = await runCommand(parts[0], parts.slice(1), root, timeoutMs);
    const failures = parseTestFailures(r.output);
    const passed = r.ok && failures.length === 0;
    result.test = {
      status: passed ? "passed" : "failed",
      failures,
      output: r.output.slice(0, 3000),
    };
  } else if (!skipTest && !test_cmd) {
    result.test = { status: strict ? "failed" : "skipped", failures: [], output: "no test command found" };
  }

  const allPassed = result.lint.status === "passed" && result.test.status === "passed";
  const anyFailed = result.lint.status === "failed" || result.test.status === "failed";

  return textResult(
    JSON.stringify({
      passed: allPassed && !anyFailed,
      status: anyFailed ? "failed" : (allPassed ? "passed" : "partially_skipped"),
      lint: result.lint,
      test: result.test,
      strict,
    }),
  );
}
