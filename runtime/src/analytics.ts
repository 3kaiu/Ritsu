/**
 * Agent Behavior Analytics Engine
 *
 * Aggregates ctx events into actionable team-level insights:
 * - Quality trends by month / skill
 * - Cost breakdown by model
 * - Top violations ranking
 * - Slow span identification
 *
 * v8.1.0 — reads from existing ctx data, no new data collection needed.
 */

import { readAllEntries } from "./ctx-reader.js";
import type { CtxEvent } from "./cli/types.js";

// ─── Types ────────────────────────────────────────────────────

export interface MonthlyTrend {
  month: string; // "2026-05"
  total: number;
  passed: number;
  failed: number;
  violations: number;
  avg_duration_ms: number;
  total_tokens: number;
}

export interface SkillBreakdown {
  skill: string;
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  avg_violations: number;
}

export interface CostBreakdown {
  model: string;
  total_tokens_in: number;
  total_tokens_out: number;
  estimated_cost_usd: number;
  session_count: number;
}

export interface ViolationRanking {
  rule_id: string;
  severity: string;
  count: number;
  latest_seen: string;
}

export interface SlowSpan {
  span_id: string;
  skill: string;
  duration_ms: number;
  ts: string;
  summary: string;
}

export interface AnalyticsReport {
  generated_at: string;
  project: string;
  period: string;
  summary: {
    total_sessions: number;
    total_violations: number;
    overall_pass_rate: number;
    total_cost_estimate: number;
  };
  skill_breakdown: SkillBreakdown[];
  monthly_trend: MonthlyTrend[];
  cost_breakdown: CostBreakdown[];
  top_violations: ViolationRanking[];
  slowest_spans: SlowSpan[];
}

// Rough model pricing per 1K tokens (USD), as of May 2026
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-7": { input: 0.015, output: 0.075 },
  "claude-sonnet-4-6": { input: 0.003, output: 0.015 },
  "claude-sonnet-4-7": { input: 0.003, output: 0.015 },
  "claude-haiku-4-5": { input: 0.0008, output: 0.004 },
  "claude-3.5-sonnet": { input: 0.003, output: 0.015 },
  "claude-3-haiku": { input: 0.00025, output: 0.00125 },
  "gpt-4o": { input: 0.0025, output: 0.01 },
  "gpt-4.1": { input: 0.002, output: 0.008 },
  "gpt-4.1-mini": { input: 0.0004, output: 0.0016 },
  "gpt-4.1-nano": { input: 0.0001, output: 0.0004 },
  "deepseek-chat": { input: 0.00027, output: 0.0011 },
  "deepseek-reasoner": { input: 0.00055, output: 0.00219 },
  "gemini-2.5-pro": { input: 0.00125, output: 0.005 },
  "gemini-2.5-flash": { input: 0.000075, output: 0.0003 },
};

function getModelPricing(model: string): { input: number; output: number } {
  // Try exact match
  const exact = MODEL_PRICING[model];
  if (exact) return exact;

  // Try prefix match
  for (const [key, price] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return price;
  }

  // Default: unknown model, use claude-sonnet pricing as conservative estimate
  return { input: 0.003, output: 0.015 };
}

// ─── Query Functions ─────────────────────────────────────────

/**
 * Extract month string from ISO timestamp.
 */
function getMonth(ts: string): string {
  return ts.slice(0, 7); // "2026-05-27T..." → "2026-05"
}

/**
 * Load all ctx events, optionally filtered to recent months.
 */
function loadEvents(projectRoot: string, months?: number): Record<string, unknown>[] {
  const all = readAllEntries(projectRoot);
  if (!months || months <= 0) return all;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = cutoff.toISOString().slice(0, 7);

  return all.filter((e) => {
    const ts = typeof e.ts === "string" ? e.ts : "";
    return ts >= cutoffStr || getMonth(ts) >= cutoffStr;
  });
}

/**
 * Cast a raw event to CtxEvent shape (safe access).
 */
function asCtxEvent(raw: Record<string, unknown>): CtxEvent {
  return raw as unknown as CtxEvent;
}

// ─── Quality Trends ──────────────────────────────────────────

export function queryQualityTrends(
  projectRoot: string,
  months = 6,
): MonthlyTrend[] {
  const events = loadEvents(projectRoot, months);
  const byMonth = new Map<string, Record<string, unknown>[]>();

  for (const event of events) {
    const e = asCtxEvent(event);
    if (e.status !== "done" && e.status !== "failed") continue;
    if (!e.skill) continue;

    const month = getMonth(e.ts || "");
    if (!month) continue;

    const existing = byMonth.get(month);
    if (existing) {
      existing.push(event);
    } else {
      byMonth.set(month, [event]);
    }
  }

  const trends: MonthlyTrend[] = [];

  for (const [month, monthEvents] of byMonth.entries()) {
    let passed = 0;
    let failed = 0;
    let violations = 0;
    let totalDuration = 0;
    let durationCount = 0;
    let totalTokens = 0;

    for (const raw of monthEvents) {
      const e = asCtxEvent(raw);
      if (e.status === "done") passed++;
      else if (e.status === "failed") failed++;

      if (e.violation) violations++;

      if (e.cost?.duration_ms) {
        totalDuration += e.cost.duration_ms;
        durationCount++;
      }
      if (e.cost?.tokens_in) totalTokens += e.cost.tokens_in;
      if (e.cost?.tokens_out) totalTokens += e.cost.tokens_out;
    }

    trends.push({
      month,
      total: monthEvents.length,
      passed,
      failed,
      violations,
      avg_duration_ms: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
      total_tokens: totalTokens,
    });
  }

  trends.sort((a, b) => a.month.localeCompare(b.month));
  return trends;
}

// ─── Skill Breakdown ─────────────────────────────────────────

export function querySkillBreakdown(projectRoot: string): SkillBreakdown[] {
  const events = loadEvents(projectRoot);
  const bySkill = new Map<string, Record<string, unknown>[]>();

  for (const event of events) {
    const e = asCtxEvent(event);
    if (e.status !== "done" && e.status !== "failed") continue;
    if (!e.skill) continue;

    if (!bySkill.has(e.skill)) bySkill.set(e.skill, []);
    bySkill.get(e.skill)!.push(event);
  }

  const breakdown: SkillBreakdown[] = [];

  for (const [skill, skillEvents] of bySkill.entries()) {
    let passed = 0;
    let failed = 0;
    let violations = 0;

    for (const raw of skillEvents) {
      const e = asCtxEvent(raw);
      if (e.status === "done") passed++;
      else if (e.status === "failed") failed++;
      if (e.violation) violations++;
    }

    breakdown.push({
      skill,
      total: skillEvents.length,
      passed,
      failed,
      pass_rate: skillEvents.length > 0
        ? Math.round((passed / skillEvents.length) * 100)
        : 0,
      avg_violations: skillEvents.length > 0
        ? Math.round((violations / skillEvents.length) * 100) / 100
        : 0,
    });
  }

  breakdown.sort((a, b) => b.total - a.total);
  return breakdown;
}

// ─── Cost Breakdown ──────────────────────────────────────────

export function queryCostBreakdown(projectRoot: string): CostBreakdown[] {
  const events = loadEvents(projectRoot);
  const byModel = new Map<string, { tokensIn: number; tokensOut: number; sessions: Set<string> }>();

  for (const event of events) {
    const e = asCtxEvent(event);
    if (!e.cost?.model) continue;

    let entry = byModel.get(e.cost.model);
    if (!entry) {
      entry = { tokensIn: 0, tokensOut: 0, sessions: new Set() };
      byModel.set(e.cost.model, entry);
    }

    entry.tokensIn += e.cost.tokens_in ?? 0;
    entry.tokensOut += e.cost.tokens_out ?? 0;
    if (e.trace_id) entry.sessions.add(e.trace_id);
  }

  const breakdown: CostBreakdown[] = [];

  for (const [model, data] of byModel.entries()) {
    const pricing = getModelPricing(model);
    const costIn = (data.tokensIn / 1000) * pricing.input;
    const costOut = (data.tokensOut / 1000) * pricing.output;

    breakdown.push({
      model,
      total_tokens_in: data.tokensIn,
      total_tokens_out: data.tokensOut,
      estimated_cost_usd: Math.round((costIn + costOut) * 100) / 100,
      session_count: data.sessions.size,
    });
  }

  breakdown.sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd);
  return breakdown;
}

// ─── Top Violations ──────────────────────────────────────────

export function queryTopViolations(
  projectRoot: string,
  limit = 10,
): ViolationRanking[] {
  const events = loadEvents(projectRoot);
  const byRule = new Map<string, { severity: string; count: number; latest: string }>();

  for (const event of events) {
    const e = asCtxEvent(event);
    if (!e.violation?.rule_id) continue;

    const ruleId = e.violation.rule_id;
    const existing = byRule.get(ruleId);

    if (existing) {
      existing.count++;
      if (e.ts && e.ts > existing.latest) existing.latest = e.ts;
    } else {
      byRule.set(ruleId, {
        severity: e.violation.severity,
        count: 1,
        latest: e.ts || "",
      });
    }
  }

  const rankings: ViolationRanking[] = [];

  for (const [ruleId, data] of byRule.entries()) {
    rankings.push({
      rule_id: ruleId,
      severity: data.severity,
      count: data.count,
      latest_seen: data.latest,
    });
  }

  rankings.sort((a, b) => b.count - a.count);
  return rankings.slice(0, limit);
}

// ─── Slow Spans ──────────────────────────────────────────────

export function querySlowestSpans(
  projectRoot: string,
  limit = 10,
): SlowSpan[] {
  const events = loadEvents(projectRoot);
  const spans: SlowSpan[] = [];

  for (const event of events) {
    const e = asCtxEvent(event);
    if (!e.cost?.duration_ms || e.cost.duration_ms < 1000) continue;
    if (!e.span_id && !e.correlation_id) continue;

    spans.push({
      span_id: e.span_id || e.correlation_id || "unknown",
      skill: e.skill || "unknown",
      duration_ms: e.cost.duration_ms,
      ts: e.ts || "",
      summary: e.step || `${e.skill || "unknown"}:${e.status || "unknown"}`,
    });
  }

  spans.sort((a, b) => b.duration_ms - a.duration_ms);
  return spans.slice(0, limit);
}

// ─── Full Report ─────────────────────────────────────────────

export function generateReport(
  projectRoot: string,
  options: {
    months?: number;
    slowSpanLimit?: number;
    violationLimit?: number;
  } = {},
): AnalyticsReport {
  const { months = 6, slowSpanLimit = 10, violationLimit = 10 } = options;

  const trends = queryQualityTrends(projectRoot, months);
  const skillBreakdown = querySkillBreakdown(projectRoot);
  const costBreakdown = queryCostBreakdown(projectRoot);
  const topViolations = queryTopViolations(projectRoot, violationLimit);
  const slowSpans = querySlowestSpans(projectRoot, slowSpanLimit);

  const totalSessions = trends.reduce((sum, t) => sum + t.total, 0);
  const totalViolations = trends.reduce((sum, t) => sum + t.violations, 0);
  const totalPassed = trends.reduce((sum, t) => sum + t.passed, 0);
  const totalCost = costBreakdown.reduce((sum, c) => sum + c.estimated_cost_usd, 0);
  const overallPassRate = totalSessions > 0
    ? Math.round((totalPassed / totalSessions) * 100)
    : 0;

  const period = months === 0
    ? "all"
    : `last ${months} months`;

  return {
    generated_at: new Date().toISOString(),
    project: projectRoot,
    period,
    summary: {
      total_sessions: totalSessions,
      total_violations: totalViolations,
      overall_pass_rate: overallPassRate,
      total_cost_estimate: Math.round(totalCost * 100) / 100,
    },
    skill_breakdown: skillBreakdown,
    monthly_trend: trends,
    cost_breakdown: costBreakdown,
    top_violations: topViolations,
    slowest_spans: slowSpans,
  };
}
