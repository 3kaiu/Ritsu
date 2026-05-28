/**
 * fe-sight — Content-Driven Size Verifier
 *
 * Many UI elements don't have explicit width/height in CSS.
 * Their size comes from: padding + font-size × line-height + content.
 *
 * This module verifies that when a design has no explicit height,
 * the rendered element's height is consistent with its padding + text content.
 *
 * Example:
 *   Design: button, no explicit height, padding 12px top/bottom, text 16px
 *   Rendered: height: 44px, padding: 12px, font-size: 16px, line-height: 1.5
 *   → Expected height: 12 + 16*1.5 + 12 = 48px
 *   → Actual: 44px (close — likely line-height 1.4)
 *   → PASS with minor note
 */

import type { DesignElement, RenderedElement } from "../types.js";

export interface ContentSizeIssue {
  type: "height-mismatch" | "width-mismatch" | "padding-content-conflict";
  description: string;
  expectedMin: number;
  actual: number;
  severity: "critical" | "major" | "minor";
}

/**
 * Estimate the expected minimum height from padding + font metrics + content lines.
 * Content lines are estimated from element type (button ≈ 1 line, paragraph ≈ 2-3).
 */
function estimateContentHeight(
  padding: { top: number; bottom: number },
  fontSize: number,
  lineHeight: number,
  contentLines: number,
): number {
  const contentHeight = fontSize * lineHeight * contentLines;
  return padding.top + contentHeight + padding.bottom;
}

function parsePadding(val: string | undefined): { top: number; bottom: number; left: number; right: number } | null {
  if (!val) return null;
  const parts = val.split(/\s+/).map(parseFloat);
  if (parts.some(isNaN)) return null;
  if (parts.length === 1) return { top: parts[0], bottom: parts[0], left: parts[0], right: parts[0] };
  if (parts.length === 2) return { top: parts[0], bottom: parts[0], left: parts[1], right: parts[1] };
  if (parts.length === 4) return { top: parts[0], bottom: parts[2], left: parts[3], right: parts[1] };
  return null;
}

function toPx(val: string | undefined): number | null {
  if (!val) return null;
  const m = val.match(/^([\d.]+)px$/);
  if (m) return parseFloat(m[1]);
  // Handle unitless line-height
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

/**
 * Verify that a rendered element's size is consistent with
 * its padding + font-size + content (content-driven sizing).
 *
 * Only checks elements where design has no explicit height/width.
 */
export function verifyContentSize(
  designElement: DesignElement,
  renderedElement: RenderedElement,
): ContentSizeIssue[] {
  const issues: ContentSizeIssue[] = [];
  const s = renderedElement.styles;

  // Only check content-driven elements (where design has no explicit height)
  const designHasHeight = !!(designElement.rect.height > 0 && designElement.rect.height < 5000);
  const designHasWidth = !!(designElement.rect.width > 0 && designElement.rect.width < 5000);

  const padding = parsePadding(s.padding);
  const fontSize = toPx(s["font-size"]) ?? 16;
  const lineHeight = toPx(s["line-height"]) ?? 1.4;
  const renderedHeight = toPx(s.height);
  const renderedWidth = toPx(s.width);

  // Estimate content lines from element tag and text
  const text = renderedElement.text ?? designElement.text ?? "";
  const estimatedLines = estimateLines(text, renderedElement.tag);
  const contentHeight = estimateContentHeight(
    { top: padding?.top ?? 0, bottom: padding?.bottom ?? 0 },
    fontSize,
    lineHeight,
    estimatedLines,
  );

  // Height check: if rendered has explicit height, verify it matches content estimate
  if (renderedHeight !== null && !designHasHeight && padding) {
    const diff = Math.abs(renderedHeight - contentHeight);
    if (diff > 8) {
      issues.push({
        type: "height-mismatch",
        description: `Expected ~${contentHeight}px (padding + ${fontSize}px font × ${lineHeight} line-height), got ${renderedHeight}px`,
        expectedMin: contentHeight,
        actual: renderedHeight,
        severity: diff > 16 ? "critical" : "major",
      });
    } else if (diff > 3) {
      issues.push({
        type: "height-mismatch",
        description: `Height off by ${diff}px: expected ~${contentHeight}px, got ${renderedHeight}px`,
        expectedMin: contentHeight,
        actual: renderedHeight,
        severity: "minor",
      });
    }
  }

  // Width check: for buttons/small elements, content-driven width
  if (renderedWidth !== null && !designHasWidth && isInlineElement(renderedElement.tag)) {
    // Inline elements with explicit width = potential issue
    if (designElement.rect.width > 0) {
      const wDiff = Math.abs(renderedWidth - designElement.rect.width);
      if (wDiff > 20 && padding) {
        issues.push({
          type: "width-mismatch",
          description: `Width ${renderedWidth}px vs design ${designElement.rect.width}px`,
          expectedMin: designElement.rect.width,
          actual: renderedWidth,
          severity: wDiff > 40 ? "major" : "minor",
        });
      }
    }
  }

  return issues;
}

function estimateLines(text: string, tag: string): number {
  if (!text) return 1;
  if (tag === "button" || tag === "a" || tag === "span" || tag === "label") return 1;
  if (tag === "h1" || tag === "h2" || tag === "h3") return 1;
  // For paragraphs, estimate by text length
  const newlines = text.split("\n").length;
  if (newlines > 1) return newlines;
  // Rough: 1 line per ~80 chars
  return Math.max(1, Math.ceil(text.length / 80));
}

function isInlineElement(tag: string): boolean {
  return ["a", "span", "button", "label", "strong", "em", "i", "b", "small", "code"].includes(tag);
}
