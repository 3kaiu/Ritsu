import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

import { getProjectRoot, textResult } from "./_utils.js";
import { runCommandInSandbox } from "../loop/sandbox.js";
import { ensureRitsuDir } from "../ctx-path.js";
import {
  buildQualityGateSnapshot,
  captureQualityGateWorktreeState,
  extractQualityGateExecutionContext,
  assessRiskLevel,
  getCoverageThreshold,
  checkCoverageThreshold,
  type CoverageByFile,
  type CoverageStats,
} from "../quality-gates.js";
import { runPolicyPreflight } from "../orchestration/policy-preflight.js";
import { getAgentsProfile } from "../agents-parser.js";

import { runTestQualityAnalysis, type TestQualityMetrics } from "../test-intelligence.js";
import { verifyContracts, type VerificationReport } from "../contract-verification.js";
import { captureViolation } from "../violation-tracker.js";
import {
  getCoverageSummaryCached,
} from "../coverage-adapters.js";
import {
  detectTestRunner,
  injectReporterArgs,
  parseTestFailures,
  stripAnsi,
  testReportAdapters,
  type TestFailure,
} from "../test-report-adapters.js";

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


function runCommand(
  binary: string,
  args: string[],
  cwd: string,
  timeoutMs = 60_000,
): Promise<{ ok: boolean; output: string }> {
  return runCommandInSandbox(binary, args, { cwd, timeoutMs });
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

  // Capture policy violations into violation tracker
  if (!skipPolicy && policyPreflight.violations.length > 0) {
    for (const v of policyPreflight.violations) {
      try {
        captureViolation(root, {
          rule_id: v.rule_id || "POLICY",
          severity: v.severity || "error",
          message: v.message || "Policy violation",
          evidence: v.evidence,
          skill,
        });
      } catch {
        // best-effort
      }
    }
  }

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
        } catch { /* skip */ }
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

  // Adaptive Coverage Threshold: risk-based
  const riskLevel = assessRiskLevel(policyPreflight.scan_files);
  const coverageThreshold = getCoverageThreshold(riskLevel);
  const coverageLinesPct = result.coverage?.summary.lines?.pct;
  const coverageMet = checkCoverageThreshold(coverageLinesPct, coverageThreshold);

  // coverageThreshold < 0 means no requirement
  const coverageBlocked = coverageThreshold >= 0 && !coverageMet;

  // Test Quality Intelligence analysis (v8.1.0)
  const analyzeTestQuality = params.analyze_test_quality === true;
  let testQuality: TestQualityMetrics | undefined;
  if (analyzeTestQuality && result.test.status === "passed") {
    try {
      testQuality = runTestQualityAnalysis(root);
    } catch {
      // non-blocking: test quality analysis is advisory
    }
  }

  // Contract verification (v8.3.0)
  const verifyContractGates = params.verify_contracts === true;
  let contractVerification: VerificationReport | undefined;
  if (verifyContractGates) {
    try {
      contractVerification = verifyContracts(root);
    } catch {
      // non-blocking: contract verification is advisory
    }
  }

  const jsonOutput = JSON.stringify({
    passed: allPassed && !anyFailed && !policyBlocked && !coverageBlocked,
    status: policyBlocked
      ? "policy_failed"
      : coverageBlocked
        ? "coverage_failed"
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
    test_quality: testQuality,
    contract_verification: contractVerification,
    strict,
    _risk_level: riskLevel,
    _coverage_threshold: coverageThreshold >= 0 ? coverageThreshold : null,
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
      test_quality: testQuality,
      contract_verification: contractVerification,
      strict,
    });
    writeFileSync(lastGatePath, JSON.stringify(persisted));
  } catch {
    // ignore
  }

  return textResult(jsonOutput);
}
