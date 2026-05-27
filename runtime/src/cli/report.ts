/**
 * ritsu report — Agent Behavior Analytics CLI
 *
 * Generates Markdown reports from ctx event data.
 */

import { detectProjectRoot } from "../project-root.js";
import { generateReport, type AnalyticsReport } from "../analytics.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { color } from "./shared.js";

type ReportFormat = "markdown" | "json";

interface ReportOptions {
  months?: number;
  format?: ReportFormat;
  cost?: boolean;
  trend?: boolean;
}

function bar(value: number, max: number, width = 20): string {
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function pctBar(pct: number, width = 15): string {
  const filled = Math.round((pct / 100) * width);
  if (pct >= 80) return color(bar(pct, 100, width), "green");
  if (pct >= 50) return color(bar(pct, 100, width), "yellow");
  return color(bar(pct, 100, width), "red");
}

function formatDuration(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}min`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function generateMarkdown(report: AnalyticsReport): string {
  const lines: string[] = [];
  const s = report.summary;

  lines.push(`# Ritsu Agent Analytics Report`);
  lines.push(``);
  lines.push(`**Period**: ${report.period}`);
  lines.push(`**Generated**: ${report.generated_at}`);
  lines.push(`**Project**: ${report.project}`);
  lines.push(``);

  // Summary
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Sessions | ${s.total_sessions} |`);
  lines.push(`| Overall Pass Rate | ${s.overall_pass_rate}% ${pctBar(s.overall_pass_rate)} |`);
  lines.push(`| Total Violations | ${s.total_violations} |`);
  lines.push(`| Estimated Cost | $${s.total_cost_estimate} |`);
  lines.push(``);

  // Skill breakdown
  if (report.skill_breakdown.length > 0) {
    lines.push(`## Skill Breakdown`);
    lines.push(``);
    lines.push(`| Skill | Sessions | Pass Rate | Avg Violations |`);
    lines.push(`|-------|----------|-----------|----------------|`);
    for (const skill of report.skill_breakdown) {
      const passBar = pctBar(skill.pass_rate, 10);
      lines.push(`| ${skill.skill} | ${skill.total} | ${skill.pass_rate}% ${passBar} | ${skill.avg_violations} |`);
    }
    lines.push(``);
  }

  // Monthly trend
  if (report.monthly_trend.length > 0) {
    lines.push(`## Monthly Trends`);
    lines.push(``);
    lines.push(`| Month | Sessions | Pass | Fail | Violations | Avg Duration |`);
    lines.push(`|-------|----------|------|------|------------|--------------|`);
    for (const month of report.monthly_trend) {
      lines.push(
        `| ${month.month} | ${month.total} | ` +
        `${month.passed} | ${month.failed} | ${month.violations} | ` +
        `${formatDuration(month.avg_duration_ms)} |`,
      );
    }
    lines.push(``);
  }

  // Cost breakdown
  if (report.cost_breakdown.length > 0) {
    lines.push(`## Cost Breakdown by Model`);
    lines.push(``);
    lines.push(`| Model | Sessions | Tokens In | Tokens Out | Estimated Cost |`);
    lines.push(`|-------|----------|-----------|------------|----------------|`);
    const maxCost = Math.max(...report.cost_breakdown.map((c) => c.estimated_cost_usd));
    for (const cost of report.cost_breakdown) {
      lines.push(
        `| ${cost.model} | ${cost.session_count} | ` +
        `${formatTokens(cost.total_tokens_in)} | ${formatTokens(cost.total_tokens_out)} | ` +
        `$${cost.estimated_cost_usd} ${bar(cost.estimated_cost_usd, maxCost, 10)} |`,
      );
    }
    lines.push(``);
  }

  // Top violations
  if (report.top_violations.length > 0) {
    lines.push(`## Top Violations`);
    lines.push(``);
    lines.push(`| Rule | Severity | Count |`);
    lines.push(`|------|----------|-------|`);
    const maxViolations = Math.max(...report.top_violations.map((v) => v.count));
    for (const v of report.top_violations) {
      const sevColor = v.severity === "fatal" || v.severity === "hard_stop"
        ? "red"
        : v.severity === "error"
          ? "yellow"
          : "green";
      lines.push(
        `| ${color(v.rule_id, sevColor)} | ${v.severity} | ${v.count} ${bar(v.count, maxViolations, 10)} |`,
      );
    }
    lines.push(``);
  }

  // Slowest spans
  if (report.slowest_spans.length > 0) {
    lines.push(`## Slowest Spans`);
    lines.push(``);
    lines.push(`| Span | Skill | Duration | Summary |`);
    lines.push(`|------|-------|----------|---------|`);
    for (const span of report.slowest_spans) {
      lines.push(
        `| ${span.span_id.slice(0, 24)} | ${span.skill} | ` +
        `${formatDuration(span.duration_ms)} | ${span.summary} |`,
      );
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*Report generated by Ritsu v8.1.0 Analytics Engine*`);

  return lines.join("\n");
}

export function runReport(cmdArgs: string[]): void {
  const root = detectProjectRoot();
  if (!root || !existsSync(resolve(root, ".ritsu"))) {
    console.error(color("❌ Not a Ritsu-enabled project. Run /r-init first.", "red"));
    process.exit(1);
  }

  // Parse args
  const options: ReportOptions = {
    months: 6,
    format: "markdown",
  };

  for (let i = 0; i < cmdArgs.length; i++) {
    const arg = cmdArgs[i];
    if (arg === "--json") options.format = "json";
    else if (arg === "--cost") options.cost = true;
    else if (arg === "--trend") options.trend = true;
    else if (arg === "--month" && cmdArgs[i + 1]) {
      options.months = parseInt(cmdArgs[++i], 10);
      if (isNaN(options.months)) options.months = 1;
    }
  }

  const report = generateReport(root, {
    months: options.months,
  });

  // Filter sections if flags are set
  if (options.trend) {
    // Only show trend data
    const filtered = { ...report, monthly_trend: report.monthly_trend };
    if (options.format === "json") {
      console.log(JSON.stringify(filtered, null, 2));
    } else {
      console.log(generateMarkdown(filtered));
    }
    return;
  }

  if (options.cost) {
    const filtered = { ...report, cost_breakdown: report.cost_breakdown };
    if (options.format === "json") {
      console.log(JSON.stringify(filtered, null, 2));
    } else {
      // Just show cost section
      const lines: string[] = [];
      lines.push(`# Ritsu Cost Report`);
      lines.push(``);
      lines.push(`**Period**: ${report.period}`);
      lines.push(`**Total Estimated Cost**: $${report.summary.total_cost_estimate}`);
      lines.push(``);
      lines.push(`## Cost Breakdown by Model`);
      lines.push(``);
      lines.push(`| Model | Sessions | Tokens In | Tokens Out | Estimated Cost |`);
      lines.push(`|-------|----------|-----------|------------|----------------|`);
      const maxCost = Math.max(...report.cost_breakdown.map((c) => c.estimated_cost_usd));
      for (const cost of report.cost_breakdown) {
        lines.push(
          `| ${cost.model} | ${cost.session_count} | ` +
          `${formatTokens(cost.total_tokens_in)} | ${formatTokens(cost.total_tokens_out)} | ` +
          `$${cost.estimated_cost_usd} ${bar(cost.estimated_cost_usd, maxCost, 10)} |`,
        );
      }
      lines.push(``);
      console.log(lines.join("\n"));
    }
    return;
  }

  // Full report
  if (options.format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(generateMarkdown(report));
  }
}
