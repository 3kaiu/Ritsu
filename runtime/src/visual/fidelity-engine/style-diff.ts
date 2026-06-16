/**
 * fe-sight — Style Diff
 *
 * Compares CSS properties between matched design elements and rendered DOM nodes.
 * Produces per-property diffs with severity and fix suggestions.
 */

import type { DesignElement, RenderedElement, StyleDiff, Severity } from "../types.js";
import { suggestTailwindFix } from "../style-adapters/tailwind.js";

// ─── Properties to compare ───────────────────────────────────

const COMPARE_PROPS: Array<{
  key: keyof import("../types.js").CssStyles;
  label: string;
  weight: number;  // contribution to overall fidelity
  tolerance?: number; // allowed pixel difference
}> = [
  { key: "font-size", label: "Font Size", weight: 5, tolerance: 1 },
  { key: "font-weight", label: "Font Weight", weight: 4 },
  { key: "font-family", label: "Font Family", weight: 3 },
  { key: "line-height", label: "Line Height", weight: 2, tolerance: 2 },
  { key: "letter-spacing", label: "Letter Spacing", weight: 1 },
  { key: "color", label: "Color", weight: 5 },
  { key: "background-color", label: "Background", weight: 3 },
  { key: "border-color", label: "Border Color", weight: 2 },
  { key: "border-radius", label: "Border Radius", weight: 2, tolerance: 1 },
  { key: "padding", label: "Padding", weight: 3, tolerance: 2 },
  { key: "margin", label: "Margin", weight: 2, tolerance: 2 },
  { key: "width", label: "Width", weight: 2, tolerance: 2 },
  { key: "height", label: "Height", weight: 2, tolerance: 2 },
  { key: "gap", label: "Gap", weight: 2, tolerance: 1 },
  { key: "text-align", label: "Text Align", weight: 2 },
  { key: "opacity", label: "Opacity", weight: 1 },
];

// ─── Severity Assignment ─────────────────────────────────────

function assessSeverity(
  property: string,
  designValue: string,
  actualValue: string,
): Severity {
  const numericDesign = parseFloat(designValue);
  const numericActual = parseFloat(actualValue);

  if (isNaN(numericDesign) || isNaN(numericActual)) {
    // Non-numeric comparison
    return designValue.toLowerCase() === actualValue.toLowerCase()
      ? "minor" : "critical";
  }

  const diff = Math.abs(numericDesign - numericActual);

  if (property === "font-size") {
    if (diff > 4) return "critical";
    if (diff > 2) return "major";
    return "minor";
  }

  if (property === "color" || property === "background-color" || property === "border-color") {
    // Color strings like "#1a1a1a" — exact match or not
    return designValue.toLowerCase() === actualValue.toLowerCase() ? "minor" : "critical";
  }

  if (property.includes("padding") || property.includes("margin") || property === "gap") {
    if (diff > 4) return "critical";
    if (diff > 2) return "major";
    return "minor";
  }

  if (diff > 3) return "critical";
  if (diff > 1) return "major";
  return "minor";
}

// ─── Parse CSS value to number ───────────────────────────────

function parsePx(value: string): number {
  const match = value.match(/^([\d.]+)px$/);
  return match ? parseFloat(match[1]) : NaN;
}

function valuesDiffer(a: string, b: string): boolean {
  // Exact match
  if (a === b) return false;

  // Try numeric comparison
  const numA = parsePx(a);
  const numB = parsePx(b);
  if (!isNaN(numA) && !isNaN(numB)) {
    return Math.abs(numA - numB) > 1; // 1px tolerance
  }

  // Color normalization
  const normalizeColor = (c: string) => c.toLowerCase().replace(/\s/g, "");
  return normalizeColor(a) !== normalizeColor(b);
}

// ─── Main ────────────────────────────────────────────────────

export function computeStyleDiffs(
  designElement: DesignElement,
  renderedElement: RenderedElement,
  styleSystem: "tailwind" | "tokens" | "css",
): StyleDiff[] {
  const diffs: StyleDiff[] = [];
  const designStyles = designElement.style ?? {};
  const renderedStyles = renderedElement.styles;

  for (const prop of COMPARE_PROPS) {
    const designVal = (designStyles as any)[prop.key];
    const renderedVal = (renderedStyles as any)[prop.key];

    if (!designVal || !renderedVal) continue;
    if (!valuesDiffer(designVal, renderedVal)) continue;

    const severity = assessSeverity(prop.key, designVal, renderedVal);

    // Generate suggestion based on style system
    let suggestion = "";
    let suggestionType: "tailwind" | "token" | "css" = "css";

    if (styleSystem === "tailwind") {
      const twFix = suggestTailwindFix(prop.key as string, designVal, renderedVal);
      if (twFix) {
        suggestion = `${twFix.oldClass} → ${twFix.newClass}`;
        suggestionType = "tailwind";
      } else {
        suggestion = `${prop.key}: ${designVal}`;
      }
    } else {
      suggestion = `${prop.key}: ${designVal}`;
    }

    diffs.push({
      property: prop.key as string,
      designValue: designVal,
      actualValue: renderedVal,
      severity,
      suggestion,
      suggestionType,
    });
  }

  return diffs;
}

/**
 * Aggregate style diffs into an overall fidelity score.
 */
export function computeStyleScore(
  allDiffs: StyleDiff[],
): { score: number; criticalCount: number; majorCount: number; minorCount: number } {
  let score = 100;
  let criticalCount = 0;
  let majorCount = 0;
  let minorCount = 0;

  for (const diff of allDiffs) {
    if (diff.severity === "critical") {
      score -= 8;
      criticalCount++;
    } else if (diff.severity === "major") {
      score -= 4;
      majorCount++;
    } else {
      score -= 1;
      minorCount++;
    }
  }

  return { score: Math.max(0, score), criticalCount, majorCount, minorCount };
}
