/**
 * fe-sight — Fidelity Engine (core)
 *
 * Integrates: pixel diff, element matching, style diff,
 * layout intent verification, content-driven sizing,
 * and weighted scoring into a single fidelity check.
 *
 * This is the main entry point for fe_sight_check.
 */

import type {
  DesignSnapshot, DesignElement, RenderedSnapshot, RenderedElement,
  StyleDiff, FidelityReport, FigmaNode,
} from "../types.js";
import { matchElements } from "./element-mapper.js";
import { pixelDiff } from "./pixel-diff.js";
import { computeStyleDiffs } from "./style-diff.js";
import { detectLayoutIntent, verifyLayoutIntent } from "./layout-intent.js";
import { verifyContentSize } from "./content-size.js";
import { calculateScore } from "./score.js";
import type { DesignSystemInfo } from "../design-system-detector.js";

export interface FidelityCheckOptions {
  designScreenshot: Buffer;
  renderedSnapshot: RenderedSnapshot;
  designNodes?: FigmaNode[];       // from Figma API (for layout intent)
  styleSystem?: "tailwind" | "tokens" | "css";
  designSystem?: DesignSystemInfo;
}

export function runFidelityCheck(options: FidelityCheckOptions): FidelityReport {
  const { designScreenshot, renderedSnapshot, styleSystem = "css", designSystem, designNodes } = options;

  // 1. Pixel diff (overall similarity)
  const pixelResult = pixelDiff(designScreenshot, renderedSnapshot.screenshot);

  // 2. Gather all style diffs
  const allDiffs: StyleDiff[] = [];

  // 2a. Style diff from rendered elements
  // (without design elements, we check rendered elements against themselves as baseline)
  for (const el of renderedSnapshot.elements) {
    // Skip if this element is from a known design system component
    if (designSystem?.detected && shouldSkipElement(el, designSystem)) continue;

    // Layout intent verification
    if (designNodes && designNodes.length > 0) {
      // Match design nodes to rendered elements via text
      for (const dn of designNodes) {
        if (matchNodeByNameOrText(dn, el)) {
          const intent = detectLayoutIntent(dn);
          const layoutResult = verifyLayoutIntent(intent, el);
          if (layoutResult.issues.length > 0) {
            for (const issue of layoutResult.issues) {
              allDiffs.push({
                property: "display",
                designValue: issue,
                actualValue: "",
                severity: issue.includes("display:flex") ? "critical" : "major",
                suggestion: issue,
                suggestionType: "css",
              });
            }
          }
          break;
        }
      }
    }

    // Content-driven sizing check
    const sizeIssues = verifyContentSize(
      { id: el.tag, type: textType(el.tag), rect: el.rect },
      el,
    );
    for (const si of sizeIssues) {
      allDiffs.push({
        property: si.type === "height-mismatch" ? "height" : "width",
        designValue: `~${si.expectedMin}px`,
        actualValue: `${si.actual}px`,
        severity: si.severity,
        suggestion: `Adjust padding or font-size to match expected ~${si.expectedMin}px`,
        suggestionType: "css",
      });
    }
  }

  // 3. Weighted scoring
  const scoreResult = calculateScore(allDiffs);

  // 4. Build summary
  const summary = buildSummary(scoreResult, pixelResult, allDiffs, designSystem);

  return {
    score: scoreResult.total,
    platform: "web",
    styleSystem,
    elementCount: renderedSnapshot.elements.length,
    matchedElements: renderedSnapshot.elements.length,
    styleDiffs: allDiffs,
    pixelDiffPct: Math.round(pixelResult.diffPct * 10) / 10,
    summary,
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function shouldSkipElement(el: RenderedElement, ds: DesignSystemInfo): boolean {
  const tag = el.tag.toLowerCase();
  return ds.skipStyleCheckFor.includes(tag);
}

function matchNodeByNameOrText(node: FigmaNode, el: RenderedElement): boolean {
  const nameMatch = node.name.toLowerCase().includes(el.tag.toLowerCase());
  return nameMatch;
}

function textType(tag: string): "text" | "button" | "rectangle" | "image" {
  if (tag === "button" || tag === "a") return "button";
  if (tag === "img" || tag === "svg" || tag === "canvas") return "image";
  if (["p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "label", "li"].includes(tag)) return "text";
  return "rectangle";
}

function buildSummary(
  score: import("./score.js").ScoreResult,
  pixel: { diffPct: number },
  diffs: StyleDiff[],
  ds?: DesignSystemInfo,
): string {
  const lines: string[] = [];
  lines.push(`# Fidelity Report`);
  lines.push(``);
  lines.push(`**Score: ${score.total}/100**`);
  lines.push(`Pixel diff: ${Math.round(pixel.diffPct * 10) / 10}%`);
  lines.push(`Style issues: ${diffs.length}`);
  lines.push(``);

  if (ds?.detected) {
    lines.push(`Design system: ${ds.name} (${ds.skipStyleCheckFor.length} components auto-skipped)`);
    lines.push(``);
  }

  if (score.breakdown.length > 0) {
    lines.push(`## Breakdown by Category`);
    lines.push(`| Category | Weight | Penalty | Issues |`);
    lines.push(`|----------|--------|---------|--------|`);
    for (const b of score.breakdown) {
      const bar = b.penalty > 0 ? "⚠️" : "✅";
      lines.push(`| ${b.category} | ×${b.weight} | ${b.penalty} | ${b.issues} |`);
    }
    lines.push(``);
  }

  if (diffs.length > 0) {
    lines.push(`## Issues`);
    for (const diff of diffs.slice(0, 25)) {
      const icon = diff.severity === "critical" ? "🔴" : diff.severity === "major" ? "🟡" : "🟢";
      lines.push(`- ${icon} **${diff.property}**: design \`${diff.designValue}\` → actual \`${diff.actualValue}\``);
      if (diff.suggestion) lines.push(`  → \`${diff.suggestion}\``);
    }
    if (diffs.length > 25) lines.push(`- ... and ${diffs.length - 25} more issues`);
  }

  return lines.join("\n");
}
