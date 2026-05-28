/**
 * fe-sight — Layout Intent Detector
 *
 * Reads design node properties and determines the layout intent:
 *   - flex: auto-layout with direction, gap, alignment
 *   - content-driven: no fixed height, sized by padding + content
 *   - fixed: explicit width/height
 *   - absolute: positioned relative to parent
 *
 * The key insight: design tools express ALL positions in absolute coordinates,
 * but code implements them as flex, flow, grid, or absolute positioning.
 * This module extracts the DESIGNER's intent, so we can verify the CODE
 * implements that intent correctly — not that coordinates happen to match.
 */

import type { FigmaNode, RenderedElement, CssStyles } from "../types.js";

// Figma nodes may have width/height as direct properties from API
interface FigmaNodeWithSize extends FigmaNode {
  width?: number;
  height?: number;
}

// ─── Layout Intent Types ─────────────────────────────────────

export type LayoutMode = "flex" | "grid" | "content-driven" | "fixed" | "absolute" | "unknown";

export interface FlexIntent {
  type: "flex";
  direction: "row" | "column";
  gap: number;
  mainAlign: string;     // primaryAxisAlignItems → justify-content
  crossAlign: string;    // counterAxisAlignItems → align-items
  padding: { top: number; right: number; bottom: number; left: number };
}

export interface ContentDrivenIntent {
  type: "content-driven";
  padding: { top: number; right: number; bottom: number; left: number };
  minHeight?: number;
  minWidth?: number;
  expectedFontSize?: number;   // from text children
  expectedLineHeight?: number;
}

export interface FixedIntent {
  type: "fixed";
  width: number;
  height: number;
}

export interface AbsoluteIntent {
  type: "absolute";
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface GridIntent {
  type: "grid";
  columns?: number;
  rows?: number;
  gap?: number;
  alignment?: string;
}

export type LayoutIntent = FlexIntent | ContentDrivenIntent | FixedIntent | AbsoluteIntent | GridIntent;

// ─── Detection ────────────────────────────────────────────────

/**
 * Determine layout intent from a Figma/MasterGo design node.
 */
export function detectLayoutIntent(node: FigmaNodeWithSize): LayoutIntent {
  // Grid layout → detect from Figma layout grids
  if (node.layoutGrids && Array.isArray(node.layoutGrids)) {
    const grid = node.layoutGrids.find((g: { pattern: string }) => g.pattern === "GRID");
    if (grid) {
      // Count columns/rows from grid config
      const sectionCount = (grid as { sectionSize?: number }).sectionSize ?? 12;
      return {
        type: "grid",
        columns: sectionCount > 20 ? undefined : sectionCount,
        gap: node.itemSpacing ?? 0,
      } satisfies GridIntent;
    }
  }
  // Also detect grid from CSS display property in rendered
  if (node.type === "FRAME" && node.layoutMode === "NONE" && node.layoutGrids?.length) {
    return { type: "grid", gap: node.itemSpacing ?? 0 } satisfies GridIntent;
  }

  // Auto-layout → flex
  if (node.layoutMode && node.layoutMode !== "NONE") {
    return {
      type: "flex",
      direction: node.layoutMode === "HORIZONTAL" ? "row" : "column",
      gap: node.itemSpacing ?? 0,
      mainAlign: node.primaryAxisAlignItems ?? "MIN",
      crossAlign: node.counterAxisAlignItems ?? "MIN",
      padding: {
        top: node.paddingTop ?? 0,
        right: node.paddingRight ?? 0,
        bottom: node.paddingBottom ?? 0,
        left: node.paddingLeft ?? 0,
      },
    } satisfies FlexIntent;
  }

  // Has text child → likely content-driven
  if (hasTextChild(node) || hasNoFixedHeight(node)) {
    return {
      type: "content-driven",
      padding: {
        top: node.paddingTop ?? 0,
        right: node.paddingRight ?? 0,
        bottom: node.paddingBottom ?? 0,
        left: node.paddingLeft ?? 0,
      },
    } satisfies ContentDrivenIntent;
  }

  // Has explicit width/height → fixed
  if (hasFixedSize(node)) {
    return {
      type: "fixed",
      width: node.width ?? 0,
      height: node.height ?? 0,
    } satisfies FixedIntent;
  }

  return {
    type: "content-driven",
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  };
}

/**
 * Verify a rendered element against the design's layout intent.
 * Returns a score (0-1) and list of issues.
 */
export function verifyLayoutIntent(
  intent: LayoutIntent,
  rendered: RenderedElement,
): { score: number; issues: string[] } {
  const issues: string[] = [];
  const r = rendered.styles;

  switch (intent.type) {
    case "grid": {
      if (r.display !== "grid") {
        issues.push(`Layout: expected display:grid, got ${r.display ?? "block"}`);
      }
      if (intent.gap && intent.gap > 0) {
        const actualGap = parsePx(r.gap);
        if (actualGap !== null && Math.abs(actualGap - intent.gap) > 2) {
          issues.push(`Grid gap: expected ${intent.gap}px, got ~${actualGap}px`);
        }
      }
      if (intent.columns) {
        const expectedCols = intent.columns;
        const colsMatch = r["grid-template-columns"]?.match(/repeat\((\d+)/);
        if (colsMatch && parseInt(colsMatch[1]) !== expectedCols) {
          issues.push(`Grid columns: expected ${expectedCols}, got ${colsMatch[1]}`);
        }
      }
      break;
    }
    case "flex": {
      // Check display: flex
      if (r.display !== "flex") {
        issues.push(`Layout: expected display:flex, got ${r.display ?? "block"}`);
      }

      // Check direction
      const expectedDir = intent.direction === "row" ? "row" : "column";
      if (r["flex-direction"] && r["flex-direction"] !== expectedDir) {
        issues.push(`Flex direction: expected ${expectedDir}, got ${r["flex-direction"]}`);
      }

      // Check gap
      if (intent.gap > 0) {
        const actualGap = parsePx(r.gap);
        if (actualGap !== null && Math.abs(actualGap - intent.gap) > 2) {
          issues.push(`Gap: expected ${intent.gap}px, got ~${actualGap}px`);
        }
      }

      // Check padding
      const padIssues = checkPadding(r, intent.padding);
      issues.push(...padIssues);
      break;
    }

    case "content-driven": {
      // Should NOT have fixed height → verify height ≈ padding + content
      const actualHeight = parsePx(r.height);
      const actualPadding = parsePadding(r.padding);

      if (actualHeight !== null && actualPadding) {
        const expectedMinHeight = actualPadding.top + actualPadding.bottom + 16;
        if (actualHeight > expectedMinHeight * 1.5) {
          // Height is explicitly set much larger than padding would suggest
          // This might be intentional, but flag it
          issues.push(`Height ${actualHeight}px is much larger than padding suggests (~${expectedMinHeight}px)`);
        }
      }

      // Check padding
      const padIssues = checkPadding(r, intent.padding);
      issues.push(...padIssues);
      break;
    }

    case "fixed": {
      // Check explicit width/height match (with tolerance)
      const actualW = parsePx(r.width);
      const actualH = parsePx(r.height);

      if (actualW !== null && Math.abs(actualW - intent.width) > 3) {
        issues.push(`Width: expected ~${intent.width}px, got ${actualW}px`);
      }
      if (actualH !== null && Math.abs(actualH - intent.height) > 3) {
        issues.push(`Height: expected ~${intent.height}px, got ${actualH}px`);
      }
      break;
    }

    case "absolute": {
      // Check if element is absolutely positioned
      if (!r.position || r.position !== "absolute") {
        issues.push(`Position: design uses absolute positioning, but rendered element does not have position:absolute`);
      }
      break;
    }
  }

  // Calculate score
  const score = issues.length === 0 ? 1 : Math.max(0, 1 - issues.length * 0.2);
  return { score, issues };
}

// ─── Helpers ─────────────────────────────────────────────────

function parsePx(val: string | undefined): number | null {
  if (!val) return null;
  const m = val.match(/^([\d.]+)px$/);
  return m ? parseFloat(m[1]) : null;
}

function parsePadding(val: string | undefined): { top: number; right: number; bottom: number; left: number } | null {
  if (!val) return null;
  const parts = val.split(/\s+/).map(parseFloat);
  if (parts.length === 1) return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
  if (parts.length === 2) return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
  if (parts.length === 4) return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
  return null;
}

function checkPadding(
  rendered: Record<string, string>,
  expected: { top: number; right: number; bottom: number; left: number },
): string[] {
  const issues: string[] = [];
  const actual = parsePadding(rendered.padding);

  if (actual) {
    if (Math.abs(actual.top - expected.top) > 2) issues.push(`Padding top: expected ${expected.top}px, got ${actual.top}px`);
    if (Math.abs(actual.bottom - expected.bottom) > 2) issues.push(`Padding bottom: expected ${expected.bottom}px, got ${actual.bottom}px`);
    if (Math.abs(actual.left - expected.left) > 2) issues.push(`Padding left: expected ${expected.left}px, got ${actual.left}px`);
    if (Math.abs(actual.right - expected.right) > 2) issues.push(`Padding right: expected ${expected.right}px, got ${actual.right}px`);
  } else if (expected.top + expected.bottom + expected.left + expected.right > 0) {
    issues.push(`No padding found on element with design padding`);
  }

  return issues;
}

function hasTextChild(node: FigmaNode): boolean {
  if (!node.children) return false;
  return node.children.some((c) => c.type === "TEXT" || (c.children && hasTextChild(c)));
}

function hasNoFixedHeight(node: FigmaNodeWithSize): boolean {
  return !node.width && !node.height;
}

function hasFixedSize(node: FigmaNodeWithSize): boolean {
  return !!(node.width && node.height && node.width > 0 && node.height > 0);
}
