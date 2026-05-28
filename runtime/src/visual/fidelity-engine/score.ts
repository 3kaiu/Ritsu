/**
 * fe-sight — Weighted Fidelity Scoring
 *
 * Different style issues have different impact on visual fidelity.
 * A wrong font-size breaks the design far more than a wrong opacity.
 *
 * Weights:
 *   Layout    ×10 — display, flex-direction, gap, position
 *   Typography ×8 — font-size, font-family, font-weight, line-height
 *   Spacing   ×6 — padding, margin
 *   Color     ×4 — color, background-color, border-color
 *   Visual    ×3 — border-radius, box-shadow, opacity
 */

import type { StyleDiff } from "../types.js";

const CATEGORY_WEIGHTS: Record<string, number> = {
  // Layout (×10)
  display: 10,
  "flex-direction": 10,
  "justify-content": 10,
  "align-items": 10,
  position: 10,

  // Typography (×8)
  "font-size": 8,
  "font-family": 8,
  "font-weight": 8,
  "line-height": 8,
  "letter-spacing": 8,

  // Spacing (×6)
  padding: 6,
  margin: 6,
  gap: 6,

  // Color (×4)
  color: 4,
  "background-color": 4,
  "border-color": 4,

  // Visual (×3)
  "border-radius": 3,
  "box-shadow": 3,
  opacity: 3,

  // Layout (×10) — grid
  "grid-template-columns": 10,
  "grid-template-rows": 10,
  "grid-gap": 10,

  // Other (default ×5)
  width: 5,
  height: 5,
  "text-align": 2,
};

const SEVERITY_PENALTY: Record<string, number> = {
  critical: 1.0,   // full weight applied
  major: 0.5,      // half weight
  minor: 0.15,     // 15% weight
};

export interface ScoreResult {
  total: number;           // 0-100
  breakdown: Array<{
    category: string;
    weight: number;
    penalty: number;
    issues: number;
  }>;
  maxPossibleScore: number;
  appliedPenalty: number;
}

/**
 * Calculate weighted fidelity score from style diffs.
 *
 * Formula:
 *   For each diff: penalty += CATEGORY_WEIGHT * SEVERITY_PENALTY
 *   Max possible = sum of all CATEGORY_WEIGHT for properties with diffs
 *   Score = max(0, 100 - (totalPenalty / maxPossible * 100))
 *
 * This ensures:
 *   - Layout breaks hurt more than color mismatches
 *   - Multiple minor issues accumulate (unlike binary pass/fail)
 *   - Score is always 0-100 regardless of how many properties are checked
 */
export function calculateScore(diffs: StyleDiff[]): ScoreResult {
  if (diffs.length === 0) {
    return {
      total: 100,
      breakdown: [],
      maxPossibleScore: 0,
      appliedPenalty: 0,
    };
  }

  const categoryMap = new Map<string, { weight: number; penalty: number; count: number }>();

  for (const diff of diffs) {
    const weight = CATEGORY_WEIGHTS[diff.property] ?? 5;
    const severityMult = SEVERITY_PENALTY[diff.severity] ?? 0.5;
    const penalty = weight * severityMult;

    const cat = getCategory(diff.property);
    const existing = categoryMap.get(cat) ?? { weight: 0, penalty: 0, count: 0 };
    existing.weight += weight;
    existing.penalty += penalty;
    existing.count += 1;
    categoryMap.set(cat, existing);
  }

  const breakdown = [...categoryMap.entries()]
    .map(([category, data]) => ({
      category,
      weight: data.weight,
      penalty: Math.round(data.penalty * 10) / 10,
      issues: data.count,
    }))
    .sort((a, b) => b.weight - a.weight);

  const appliedPenalty = breakdown.reduce((s, b) => s + b.penalty, 0);

  // Simple subtractive model with diminishing returns per additional issue
  // First issue in a category takes full weight, subsequent ones 40%
  // This ensures: 1 critical → ~90, 10 minors → accumulates
  let totalPenalty = 0;
  const catFirstPenalty = new Map<string, boolean>();

  for (const diff of diffs) {
    const weight = CATEGORY_WEIGHTS[diff.property] ?? 5;
    const severityMult = SEVERITY_PENALTY[diff.severity] ?? 0.5;
    const cat = getCategory(diff.property);

    const isFirst = !catFirstPenalty.get(cat);
    catFirstPenalty.set(cat, true);

    const perIssuePenalty = isFirst ? weight * severityMult : weight * severityMult * 0.4;
    totalPenalty += perIssuePenalty;
  }

  const total = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));

  return {
    total,
    breakdown,
    maxPossibleScore: breakdown.reduce((s, b) => s + b.weight, 0),
    appliedPenalty: Math.round(appliedPenalty * 10) / 10,
  };
}

function getCategory(property: string): string {
  if (["display", "flex-direction", "justify-content", "align-items", "position", "grid-template-columns", "grid-template-rows", "grid-gap"].includes(property)) return "layout";
  if (["font-size", "font-family", "font-weight", "line-height", "letter-spacing"].includes(property)) return "typography";
  if (["padding", "margin", "gap"].includes(property)) return "spacing";
  if (["color", "background-color", "border-color"].includes(property)) return "color";
  if (["border-radius", "box-shadow", "opacity"].includes(property)) return "visual";
  return "other";
}
