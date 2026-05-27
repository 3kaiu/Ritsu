/**
 * Test Report Adapters
 *
 * Extracted from run-quality-gates.ts for separation of concerns.
 * Each adapter injects reporter arguments and parses a specific format.
 *
 * v8.6.0
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Types ───────────────────────────────────────────────────

export interface TestFailure {
  suite: string;
  test: string;
  error: string;
  file_hint: string;
}

export interface TestReportAdapter {
  supports(runner: "vitest" | "jest"): boolean;
  injectReporterArgs(args: string[], reportPath: string): string[];
  parse(content: string): TestFailure[];
}

// ─── Vitest JSON ─────────────────────────────────────────────

export class VitestJsonTestAdapter implements TestReportAdapter {
  supports(runner: "vitest" | "jest"): boolean {
    return runner === "vitest";
  }

  injectReporterArgs(args: string[], reportPath: string): string[] {
    return [...args, "--reporter=json", "--outputFile", reportPath];
  }

  parse(content: string): TestFailure[] {
    const parsed = JSON.parse(content);
    const failures: TestFailure[] = [];
    if (parsed && Array.isArray(parsed.testResults)) {
      for (const suite of parsed.testResults) {
        if (suite.status === "failed") {
          for (const assertion of suite.assertionResults) {
            if (assertion.status === "failed") {
              failures.push({
                suite: suite.name,
                test: assertion.fullName || assertion.title,
                error: assertion.failureMessages?.join("\n") || "Unknown error",
                file_hint: suite.name,
              });
            }
          }
        }
      }
    }
    return failures;
  }
}

// ─── Jest JSON ───────────────────────────────────────────────

export class JestJsonTestAdapter implements TestReportAdapter {
  supports(runner: "vitest" | "jest"): boolean {
    return runner === "jest";
  }

  injectReporterArgs(args: string[], reportPath: string): string[] {
    return [...args, "--json", "--outputFile", reportPath];
  }

  parse(content: string): TestFailure[] {
    const parsed = JSON.parse(content);
    const failures: TestFailure[] = [];
    if (parsed && Array.isArray(parsed.testResults)) {
      for (const suite of parsed.testResults) {
        if (suite.status === "failed") {
          for (const assertion of suite.assertionResults) {
            if (assertion.status === "failed") {
              failures.push({
                suite: suite.name,
                test: assertion.fullName || assertion.title,
                error: assertion.failureMessages?.join("\n") || "Unknown error",
                file_hint: suite.name,
              });
            }
          }
        }
      }
    }
    return failures;
  }
}

// ─── Registry ────────────────────────────────────────────────

export const testReportAdapters: TestReportAdapter[] = [
  new VitestJsonTestAdapter(),
  new JestJsonTestAdapter(),
];

// ─── Detection ───────────────────────────────────────────────

export function detectTestRunner(command: {
  binary: string;
  args: string[];
  cwd: string;
}): "vitest" | "jest" | null {
  const fullCmd = [command.binary, ...command.args].join(" ");
  if (fullCmd.includes("vitest")) return "vitest";
  if (fullCmd.includes("jest")) return "jest";
  if (fullCmd.includes("bun test")) return "vitest";

  try {
    const pkgPath = resolve(command.cwd, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const scripts = pkg.scripts ?? {};
      const scriptName = command.args.find((arg: string) => scripts[arg] !== undefined);
      if (scriptName) {
        const scriptCmd = scripts[scriptName];
        if (scriptCmd.includes("vitest")) return "vitest";
        if (scriptCmd.includes("jest")) return "jest";
      }
    }
  } catch { /* skip */ }

  return null;
}

// ─── Inject Args ─────────────────────────────────────────────

export function injectReporterArgs(
  binary: string,
  args: string[],
  runner: "vitest" | "jest",
  reportPath: string,
): string[] {
  const adapter = testReportAdapters.find((a) => a.supports(runner));
  if (!adapter) return args;

  const runnerArgs = adapter.injectReporterArgs([], reportPath);
  const isPackageManager = ["npm", "pnpm", "yarn", "bun"].includes(binary);
  const hasDoubleDash = args.includes("--");

  if (isPackageManager) {
    if (hasDoubleDash) {
      const idx = args.indexOf("--");
      return [...args.slice(0, idx + 1), ...runnerArgs, ...args.slice(idx + 1)];
    }
    return [...args, "--", ...runnerArgs];
  }

  return [...args, ...runnerArgs];
}

// ─── Output Parsing (fallback) ────────────────────────────────

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
}

/**
 * Parse test failures from raw CLI output (fallback when JSON report unavailable).
 */
export function parseTestFailures(output: string): TestFailure[] {
  const failures: TestFailure[] = [];
  const cleanOutput = stripAnsi(output);
  const lines = cleanOutput.split("\n");
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
