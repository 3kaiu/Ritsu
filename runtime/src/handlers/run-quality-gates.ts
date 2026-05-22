import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { getProjectRoot, textResult } from "./_utils.js";
import { ensureRitsuDir } from "../ctx-path.js";
import {
  buildQualityGateSnapshot,
  captureQualityGateWorktreeState,
  extractQualityGateExecutionContext,
  type CoverageByFile,
  type CoverageMetric,
  type CoverageStats,
} from "../quality-gates.js";
import { runPolicyPreflight } from "../orchestration/policy-preflight.js";
import { getAgentsProfile } from "../agents-parser.js";
import { isRecord } from "../shared.js";

interface TestFailure {
  suite: string;
  test: string;
  error: string;
  file_hint: string;
}

interface CommandSpec {
  cmd: string;
  cwd: string;
}

interface QualityGateResult {
  lint: { status: "passed" | "failed" | "skipped"; output: string };
  test: {
    status: "passed" | "failed" | "skipped";
    failures: TestFailure[];
    output: string;
  };
  coverage?: {
    summary: CoverageStats;
    per_file: CoverageByFile;
  };
}

function isCoverageMetric(value: unknown): value is CoverageMetric {
  if (!isRecord(value)) return false;
  return (
    typeof value.total === "number" &&
    typeof value.covered === "number" &&
    (value.skipped === undefined || typeof value.skipped === "number") &&
    typeof value.pct === "number"
  );
}

function isCoverageStats(value: unknown): value is CoverageStats {
  if (!isRecord(value)) return false;
  return (
    (value.lines === undefined || isCoverageMetric(value.lines)) &&
    (value.statements === undefined || isCoverageMetric(value.statements)) &&
    (value.functions === undefined || isCoverageMetric(value.functions)) &&
    (value.branches === undefined || isCoverageMetric(value.branches)) &&
    (value.branchesTrue === undefined || isCoverageMetric(value.branchesTrue))
  );
}

export interface CoverageAdapter {
  supports(filePath: string): boolean;
  parse(content: string, filePath: string): {
    summary: CoverageStats;
    per_file: CoverageByFile;
  } | null;
}

export class PythonCoverageJsonAdapter implements CoverageAdapter {
  supports(filePath: string): boolean {
    return filePath.endsWith("coverage.json");
  }

  parse(content: string, _filePath: string): {
    summary: CoverageStats;
    per_file: CoverageByFile;
  } | null {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && parsed.totals) {
        const t = parsed.totals;
        const pct = typeof t.percent_covered === "number" ? t.percent_covered : 0;
        const covered = typeof t.covered_lines === "number" ? t.covered_lines : 0;
        const total = typeof t.num_statements === "number" ? t.num_statements : 0;
        const summary: CoverageStats = {
          lines: { total, covered, skipped: 0, pct },
          statements: { total, covered, skipped: 0, pct },
          functions: { total: 0, covered: 0, skipped: 0, pct: 100 },
          branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
        };
        const perFile: CoverageByFile = {};
        if (parsed.files && typeof parsed.files === "object") {
          for (const [file, info] of Object.entries(parsed.files)) {
            if (info && typeof info === "object" && "summary" in info) {
              const sum = (info as Record<string, unknown>).summary as Record<string, unknown> | undefined;
              if (sum) {
                const fPct = typeof sum.percent_covered === "number" ? sum.percent_covered : 0;
                const fCov = typeof sum.covered_lines === "number" ? sum.covered_lines : 0;
                const fTot = typeof sum.num_statements === "number" ? sum.num_statements : 0;
                perFile[file] = {
                  lines: { total: fTot, covered: fCov, skipped: 0, pct: fPct },
                  statements: { total: fTot, covered: fCov, skipped: 0, pct: fPct },
                  functions: { total: 0, covered: 0, skipped: 0, pct: 100 },
                  branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
                };
              }
            }
          }
        }
        return { summary, per_file: perFile };
      }
    } catch {
      // ignore
    }
    return null;
  }
}

export class CoberturaXmlAdapter implements CoverageAdapter {
  supports(filePath: string): boolean {
    return filePath.endsWith("coverage.xml");
  }

  parse(content: string, _filePath: string): {
    summary: CoverageStats;
    per_file: CoverageByFile;
  } | null {
    try {
      const lineRateMatch = content.match(/line-rate="([0-9.]+)"/);
      const linesValidMatch = content.match(/lines-valid="(\d+)"/);
      const linesCoveredMatch = content.match(/lines-covered="(\d+)"/);
      const branchRateMatch = content.match(/branch-rate="([0-9.]+)"/);

      const totalLines = linesValidMatch ? parseInt(linesValidMatch[1], 10) : 0;
      const coveredLines = linesCoveredMatch ? parseInt(linesCoveredMatch[1], 10) : 0;
      const pctLines = lineRateMatch ? parseFloat(lineRateMatch[1]) * 100 : 0;
      const pctBranches = branchRateMatch ? parseFloat(branchRateMatch[1]) * 100 : 0;

      const summary: CoverageStats = {
        lines: { total: totalLines, covered: coveredLines, skipped: 0, pct: pctLines },
        statements: { total: totalLines, covered: coveredLines, skipped: 0, pct: pctLines },
        functions: { total: 0, covered: 0, skipped: 0, pct: 100 },
        branches: { total: 0, covered: 0, skipped: 0, pct: pctBranches },
      };

      const perFile: CoverageByFile = {};
      const classRegex = /<class[^>]*name="([^"]+)"[^>]*filename="([^"]+)"[^>]*line-rate="([0-9.]+)"/g;
      let match;
      while ((match = classRegex.exec(content)) !== null) {
        const file = match[2];
        const fPct = parseFloat(match[3]) * 100;
        perFile[file] = {
          lines: { total: 0, covered: 0, skipped: 0, pct: fPct },
          statements: { total: 0, covered: 0, skipped: 0, pct: fPct },
          functions: { total: 0, covered: 0, skipped: 0, pct: 100 },
          branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
        };
      }
      return { summary, per_file: perFile };
    } catch {
      // ignore
    }
    return null;
  }
}

export class GoCoverageOutAdapter implements CoverageAdapter {
  supports(filePath: string): boolean {
    return filePath.endsWith("cover.out");
  }

  parse(content: string, _filePath: string): {
    summary: CoverageStats;
    per_file: CoverageByFile;
  } | null {
    try {
      const lines = content.split(/\r?\n/);
      let totalStmt = 0;
      let coveredStmt = 0;
      const fileStats = new Map<string, { total: number; covered: number }>();

      for (const line of lines) {
        if (!line.trim() || line.startsWith("mode:")) continue;
        const parts = line.match(/^([^:]+):\d+\.\d+,\d+\.\d+\s+(\d+)\s+(\d+)$/);
        if (!parts) continue;

        const file = parts[1];
        const numStmt = parseInt(parts[2], 10);
        const count = parseInt(parts[3], 10);

        totalStmt += numStmt;
        if (count > 0) {
          coveredStmt += numStmt;
        }

        const existing = fileStats.get(file) || { total: 0, covered: 0 };
        existing.total += numStmt;
        if (count > 0) {
          existing.covered += numStmt;
        }
        fileStats.set(file, existing);
      }

      const pct = totalStmt > 0 ? (coveredStmt / totalStmt) * 100 : 100;
      const summary: CoverageStats = {
        lines: { total: totalStmt, covered: coveredStmt, skipped: 0, pct },
        statements: { total: totalStmt, covered: coveredStmt, skipped: 0, pct },
        functions: { total: 0, covered: 0, skipped: 0, pct: 100 },
        branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
      };

      const perFile: CoverageByFile = {};
      for (const [file, stats] of fileStats.entries()) {
        const fPct = stats.total > 0 ? (stats.covered / stats.total) * 100 : 100;
        perFile[file] = {
          lines: { total: stats.total, covered: stats.covered, skipped: 0, pct: fPct },
          statements: { total: stats.total, covered: stats.covered, skipped: 0, pct: fPct },
          functions: { total: 0, covered: 0, skipped: 0, pct: 100 },
          branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
        };
      }
      return { summary, per_file: perFile };
    } catch {
      // ignore
    }
    return null;
  }
}

export class VitestJsonAdapter implements CoverageAdapter {
  supports(filePath: string): boolean {
    return filePath.endsWith("coverage-summary.json") || filePath.endsWith(".json");
  }

  parse(content: string, _filePath: string): {
    summary: CoverageStats;
    per_file: CoverageByFile;
  } | null {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (!isRecord(parsed) || !isCoverageStats(parsed.total)) {
        return null;
      }

      const perFile: CoverageByFile = {};
      for (const [file, stats] of Object.entries(parsed)) {
        if (file === "total" || !isCoverageStats(stats)) continue;
        perFile[file] = stats;
      }

      return {
        summary: parsed.total,
        per_file: perFile,
      };
    } catch {
      // ignore
    }
    return null;
  }
}

const coverageAdapters: CoverageAdapter[] = [
  new PythonCoverageJsonAdapter(),
  new CoberturaXmlAdapter(),
  new GoCoverageOutAdapter(),
  new VitestJsonAdapter(),
];

function parseCoverageSummary(content: string, filePath: string): {
  summary: CoverageStats;
  per_file: CoverageByFile;
} | null {
  for (const adapter of coverageAdapters) {
    if (adapter.supports(filePath)) {
      const data = adapter.parse(content, filePath);
      if (data) return data;
    }
  }
  return null;
}

interface CoverageCacheEntry {
  mtimeMs: number;
  data: {
    summary: CoverageStats;
    per_file: CoverageByFile;
  } | null;
}

const coverageCacheMap = new Map<string, CoverageCacheEntry>();

function getCoverageSummaryCached(coveragePath: string): {
  summary: CoverageStats;
  per_file: CoverageByFile;
} | null {
  try {
    const mtimeMs = statSync(coveragePath).mtimeMs;
    const cached = coverageCacheMap.get(coveragePath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.data;
    }
    const content = readFileSync(coveragePath, "utf-8");
    const data = parseCoverageSummary(content, coveragePath);
    coverageCacheMap.set(coveragePath, { mtimeMs, data });
    return data;
  } catch {
    return null;
  }
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

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
}

function parseTestFailures(output: string): TestFailure[] {
  const failures: TestFailure[] = [];
  const cleanOutput = stripAnsi(output);

  // vitest / jest pattern: FAIL <suite>
  // followed by: × <test> [duration] or ✕ <test>
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

export interface TestReportAdapter {
  supports(runner: "vitest" | "jest"): boolean;
  injectReporterArgs(args: string[], reportPath: string): string[];
  parse(content: string): TestFailure[];
}

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

const testReportAdapters: TestReportAdapter[] = [
  new VitestJsonTestAdapter(),
  new JestJsonTestAdapter(),
];

export function detectTestRunner(command: { binary: string; args: string[]; cwd: string }): "vitest" | "jest" | null {
  const fullCmd = [command.binary, ...command.args].join(" ");
  if (fullCmd.includes("vitest")) return "vitest";
  if (fullCmd.includes("jest")) return "jest";
  if (fullCmd.includes("bun test")) return "vitest";

  try {
    const pkgPath = resolve(command.cwd, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const scripts = pkg.scripts ?? {};
      const scriptName = command.args.find(arg => scripts[arg] !== undefined);
      if (scriptName) {
        const scriptCmd = scripts[scriptName];
        if (scriptCmd.includes("vitest")) return "vitest";
        if (scriptCmd.includes("jest")) return "jest";
      }
    }
  } catch {}

  return null;
}

export function injectReporterArgs(
  binary: string,
  args: string[],
  runner: "vitest" | "jest",
  reportPath: string
): string[] {
  const adapter = testReportAdapters.find(a => a.supports(runner));
  if (!adapter) return args;

  const runnerArgs = adapter.injectReporterArgs([], reportPath);
  const isPackageManager = ["npm", "pnpm", "yarn", "bun"].includes(binary);
  const hasDoubleDash = args.includes("--");

  if (isPackageManager) {
    if (hasDoubleDash) {
      const idx = args.indexOf("--");
      const before = args.slice(0, idx + 1);
      const after = args.slice(idx + 1);
      return [...before, ...runnerArgs, ...after];
    } else {
      return [...args, "--", ...runnerArgs];
    }
  }

  return [...args, ...runnerArgs];
}

function detectPackageCommand(
  packageRoot: string,
): { lint?: CommandSpec; test?: CommandSpec } {
  const pkgPath = resolve(packageRoot, "package.json");
  if (!existsSync(pkgPath)) return {};

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const scripts = pkg.scripts ?? {};
    return {
      lint: scripts.lint ? { cmd: "npm run lint", cwd: packageRoot } : undefined,
      test: scripts["test:coverage"]
        ? { cmd: "npm run test:coverage", cwd: packageRoot }
        : scripts.test
          ? { cmd: "npm run test", cwd: packageRoot }
          : undefined,
    };
  } catch {
    return {};
  }
}

function parseAgentsMd(root: string): {
  lint_cmd?: CommandSpec;
  test_cmd?: CommandSpec;
} {
  const profile = getAgentsProfile();
  let lint_cmd: CommandSpec | undefined;
  let test_cmd: CommandSpec | undefined;

  if (profile?.lint_cmd) {
    lint_cmd = { cmd: profile.lint_cmd, cwd: root };
  }
  if (profile?.test_cmd) {
    test_cmd = { cmd: profile.test_cmd, cwd: root };
  }

  const candidates = [root, resolve(root, "runtime")];
  for (const candidate of candidates) {
    const detected = detectPackageCommand(candidate);
    if (!lint_cmd && detected.lint) {
      lint_cmd = detected.lint;
    }
    if (!test_cmd && detected.test) {
      test_cmd = detected.test;
    }
  }

  return { lint_cmd, test_cmd };
}

function parseCommand(command: CommandSpec): {
  binary: string;
  args: string[];
  cwd: string;
} {
  const parts = command.cmd.split(/\s+/).filter(Boolean);
  return {
    binary: parts[0],
    args: parts.slice(1),
    cwd: command.cwd,
  };
}

function getCommandSearchRoots(command: CommandSpec | undefined): string[] {
  if (!command) return [];

  const roots = [command.cwd];
  const parts = command.cmd.split(/\s+/).filter(Boolean);
  const prefixIdx = parts.findIndex((part) => part === "--prefix");
  if (prefixIdx !== -1 && parts[prefixIdx + 1]) {
    roots.push(resolve(command.cwd, parts[prefixIdx + 1]));
  }
  return roots;
}

function findCoverageSummaryPath(searchRoots: string[]): string | null {
  const seen = new Set<string>();
  const candidates = [
    "coverage/coverage-summary.json",
    "coverage.json",
    "coverage.xml",
    "cover.out",
  ];
  for (const root of searchRoots) {
    for (const cand of candidates) {
      const coveragePath = resolve(root, cand);
      if (seen.has(coveragePath)) continue;
      seen.add(coveragePath);
      if (existsSync(coveragePath)) {
        return coveragePath;
      }
    }
  }
  return null;
}

export async function ritsu_run_quality_gates(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const skipLint = params.skip_lint === true;
  const skipTest = params.skip_test === true;
  const strict = params.strict === true;
  const timeoutMs = Math.min(Number(params.timeout_ms ?? 60_000), 120_000);
  const executionContext = extractQualityGateExecutionContext(params);

  const skipPolicy = params.skip_policy === true;
  const skill = typeof params.skill === "string" ? params.skill : "dev";
  const policyPreflight = skipPolicy
    ? { passed: true, violations: [], scan_files: [], diff_bytes: 0 }
    : await runPolicyPreflight(root, skill);

  const { lint_cmd, test_cmd } = parseAgentsMd(root);

  const result: QualityGateResult = {
    lint: { status: "skipped", output: "" },
    test: { status: "skipped", failures: [], output: "" },
  };

  // Lint
  if (!skipLint && lint_cmd) {
    const command = parseCommand(lint_cmd);
    const r = await runCommand(
      command.binary,
      command.args,
      command.cwd,
      timeoutMs,
    );
    result.lint = { status: r.ok ? "passed" : "failed", output: stripAnsi(r.output).slice(0, 2000) };
  } else if (!skipLint && !lint_cmd) {
    result.lint = { status: strict ? "failed" : "skipped", output: "no lint command found" };
  }

  // Test
  if (!skipTest && test_cmd) {
    const command = parseCommand(test_cmd);
    const runner = detectTestRunner(command);
    let testArgs = command.args;
    let reportPath = "";

    if (runner) {
      ensureRitsuDir(root);
      reportPath = resolve(root, `.ritsu/test-report-${Date.now()}.json`);
      testArgs = injectReporterArgs(command.binary, command.args, runner, reportPath);
    }

    const r = await runCommand(
      command.binary,
      testArgs,
      command.cwd,
      timeoutMs,
    );

    let failures: TestFailure[] = [];
    let parsedOk = false;

    if (runner && reportPath) {
      try {
        const adapter = testReportAdapters.find(a => a.supports(runner));
        if (adapter && existsSync(reportPath)) {
          const content = readFileSync(reportPath, "utf-8");
          failures = adapter.parse(content);
          parsedOk = true;
        }
      } catch (err) {
        console.warn("[ritsu-qg] Failed to parse JSON test report:", err);
      } finally {
        try {
          if (existsSync(reportPath)) {
            unlinkSync(reportPath);
          }
        } catch {}
      }
    }

    if (!parsedOk) {
      failures = parseTestFailures(r.output);
    }

    const passed = r.ok && failures.length === 0;
    result.test = {
      status: passed ? "passed" : "failed",
      failures,
      output: stripAnsi(r.output).slice(0, 3000),
    };
  } else if (!skipTest && !test_cmd) {
    result.test = { status: strict ? "failed" : "skipped", failures: [], output: "no test command found" };
  }

  const allPassed = result.lint.status === "passed" && result.test.status === "passed";
  const anyFailed = result.lint.status === "failed" || result.test.status === "failed";
  const policyBlocked = !policyPreflight.passed;

  // Check for coverage
  const coveragePath = findCoverageSummaryPath([
    ...getCommandSearchRoots(test_cmd),
    ...getCommandSearchRoots(lint_cmd),
    root,
    resolve(root, "runtime"),
  ]);
  if (coveragePath) {
    try {
      const coverage = getCoverageSummaryCached(coveragePath);
      if (coverage) {
        const perFile: CoverageByFile = {};
        for (const [file, stats] of Object.entries(coverage.per_file)) {
          // Normalize paths
          const relPath = file.startsWith(root + "/")
            ? file.replace(root + "/", "")
            : file;
          perFile[relPath] = stats;
        }
        result.coverage = {
          summary: coverage.summary,
          per_file: perFile,
        };
      }
    } catch {
      // ignore
    }
  }

  const jsonOutput = JSON.stringify({
    passed: allPassed && !anyFailed && !policyBlocked,
    status: policyBlocked
      ? "policy_failed"
      : anyFailed
        ? "failed"
        : allPassed
          ? "passed"
          : "partially_skipped",
    preflight: {
      policy: {
        passed: policyPreflight.passed,
        violations: policyPreflight.violations,
        scan_files: policyPreflight.scan_files,
      },
    },
    context:
      Object.keys(executionContext).length > 0 ? executionContext : undefined,
    lint: result.lint,
    test: result.test,
    coverage: result.coverage,
    strict,
  });

  // Save for detectors to consume
  try {
    ensureRitsuDir(root);
    const lastGatePath = resolve(root, ".ritsu/last-quality-gate.json");
    const worktreeResult = await captureQualityGateWorktreeState(root);
    const persisted = buildQualityGateSnapshot({
      context: executionContext,
      worktree: worktreeResult.ok ? worktreeResult.worktree : undefined,
      ...result,
      strict,
    });
    writeFileSync(lastGatePath, JSON.stringify(persisted));
  } catch {
    // ignore
  }

  return textResult(jsonOutput);
}
