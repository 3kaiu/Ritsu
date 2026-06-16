/**
 * Coverage Adapters
 *
 * Extracted from run-quality-gates.ts for separation of concerns.
 * Each adapter parses a specific coverage report format.
 *
 * v8.6.0
 */

import { readFileSync, statSync } from "node:fs";
import { isRecord } from "./shared.js";
import type { CoverageMetric, CoverageStats, CoverageByFile } from "./quality-gates.js";

// ─── Interface ───────────────────────────────────────────────

export interface CoverageAdapter {
  supports(filePath: string): boolean;
  parse(content: string, filePath: string): {
    summary: CoverageStats;
    per_file: CoverageByFile;
  } | null;
}

// ─── Type Guards ─────────────────────────────────────────────

function isCoverageMetric(value: unknown): value is CoverageMetric {
  if (!isRecord(value)) return false;
  return (
    typeof value.total === "number" &&
    typeof value.covered === "number" &&
    (value.skipped === undefined || typeof value.skipped === "number") &&
    typeof value.pct === "number"
  );
}

export function isCoverageStats(value: unknown): value is CoverageStats {
  if (!isRecord(value)) return false;
  return (
    (value.lines === undefined || isCoverageMetric(value.lines)) &&
    (value.statements === undefined || isCoverageMetric(value.statements)) &&
    (value.functions === undefined || isCoverageMetric(value.functions)) &&
    (value.branches === undefined || isCoverageMetric(value.branches)) &&
    (value.branchesTrue === undefined || isCoverageMetric(value.branchesTrue))
  );
}

// ─── Python coverage.json ────────────────────────────────────

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
    } catch { /* ignore */ }
    return null;
  }
}

// ─── Cobertura XML ───────────────────────────────────────────

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
    } catch { /* ignore */ }
    return null;
  }
}

// ─── Go cover.out ────────────────────────────────────────────

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
        if (count > 0) coveredStmt += numStmt;

        const existing = fileStats.get(file) || { total: 0, covered: 0 };
        existing.total += numStmt;
        if (count > 0) existing.covered += numStmt;
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
    } catch { /* ignore */ }
    return null;
  }
}

// ─── Vitest JSON ─────────────────────────────────────────────

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
      if (!isRecord(parsed) || !isCoverageStats(parsed.total)) return null;

      const perFile: CoverageByFile = {};
      for (const [file, stats] of Object.entries(parsed)) {
        if (file === "total" || !isCoverageStats(stats)) continue;
        perFile[file] = stats;
      }
      return { summary: parsed.total, per_file: perFile };
    } catch { /* ignore */ }
    return null;
  }
}

// ─── Registry ────────────────────────────────────────────────

const coverageAdapters: CoverageAdapter[] = [
  new PythonCoverageJsonAdapter(),
  new CoberturaXmlAdapter(),
  new GoCoverageOutAdapter(),
  new VitestJsonAdapter(),
];

// ─── Parse ───────────────────────────────────────────────────

export function parseCoverageSummary(content: string, filePath: string): {
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

// ─── Cache ───────────────────────────────────────────────────

interface CoverageCacheEntry {
  mtimeMs: number;
  data: {
    summary: CoverageStats;
    per_file: CoverageByFile;
  } | null;
}

const coverageCacheMap = new Map<string, CoverageCacheEntry>();

export function getCoverageSummaryCached(coveragePath: string): {
  summary: CoverageStats;
  per_file: CoverageByFile;
} | null {
  try {
    const mtimeMs = statSync(coveragePath).mtimeMs;
    const cached = coverageCacheMap.get(coveragePath);
    if (cached && cached.mtimeMs === mtimeMs) return cached.data;

    const content = readFileSync(coveragePath, "utf-8");
    const data = parseCoverageSummary(content, coveragePath);
    coverageCacheMap.set(coveragePath, { mtimeMs, data });
    return data;
  } catch { return null; }
}
