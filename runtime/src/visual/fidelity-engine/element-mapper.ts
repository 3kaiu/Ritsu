/**
 * fe-sight — Element Mapper
 *
 * Core algorithm: maps design elements to rendered DOM nodes.
 *
 * Three-layer matching strategy:
 *   Layer 1 — Text content (highest confidence, exact match)
 *   Layer 2 — Position + size (IoU overlap)
 *   Layer 3 — DOM tree structure (parent-child, sibling order)
 */

import type { DesignElement, DesignSnapshot, RenderedElement, RenderedSnapshot, ElementMatch } from "../types.js";

// ─── Layer 1: Text Content Match ────────────────────────────

function matchByText(
  designElements: DesignElement[],
  renderedElements: RenderedElement[],
  matchedDesignIds: Set<string>,
  matchedRenderedIndices: Set<number>,
): ElementMatch[] {
  const matches: ElementMatch[] = [];

  // Build text index from rendered elements
  const renderedTextMap = new Map<string, number[]>();
  for (let i = 0; i < renderedElements.length; i++) {
    const text = renderedElements[i].text?.trim().toLowerCase();
    if (text && text.length > 0) {
      const existing = renderedTextMap.get(text) ?? [];
      existing.push(i);
      renderedTextMap.set(text, existing);
    }
    // Also index children text recursively
    if (renderedElements[i].children) {
      const childTexts = collectTexts(renderedElements[i].children!);
      for (const ct of childTexts) {
        const existing = renderedTextMap.get(ct) ?? [];
        if (!existing.includes(i)) existing.push(i);
        renderedTextMap.set(ct, existing);
      }
    }
  }

  for (const de of designElements) {
    if (!de.text || matchedDesignIds.has(de.id)) continue;
    const designText = de.text.trim().toLowerCase();
    if (designText.length === 0) continue;

    const candidates = renderedTextMap.get(designText);
    if (candidates) {
      // Find first unmatched candidate
      for (const ri of candidates) {
        if (!matchedRenderedIndices.has(ri)) {
          matchedDesignIds.add(de.id);
          matchedRenderedIndices.add(ri);
          matches.push({
            designId: de.id,
            renderedIndex: ri,
            confidence: 1.0,
            method: "text",
          });
          break;
        }
      }
    }
  }

  return matches;
}

function collectTexts(elements: RenderedElement[]): string[] {
  const texts: string[] = [];
  for (const el of elements) {
    if (el.text?.trim()) texts.push(el.text.trim().toLowerCase());
    if (el.children) texts.push(...collectTexts(el.children));
  }
  return texts;
}

// ─── Layer 2: Position + Size Match ─────────────────────────

function iou(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function matchByPosition(
  designElements: DesignElement[],
  renderedElements: RenderedElement[],
  matchedDesignIds: Set<string>,
  matchedRenderedIndices: Set<number>,
): ElementMatch[] {
  const matches: ElementMatch[] = [];
  const IOU_THRESHOLD = 0.3;

  for (const de of designElements) {
    if (matchedDesignIds.has(de.id)) continue;

    let bestRi = -1;
    let bestIou = 0;

    for (let ri = 0; ri < renderedElements.length; ri++) {
      if (matchedRenderedIndices.has(ri)) continue;
      const re = renderedElements[ri];
      const overlap = iou(de.rect, re.rect);
      if (overlap > bestIou) {
        bestIou = overlap;
        bestRi = ri;
      }
    }

    if (bestIou > IOU_THRESHOLD) {
      matchedDesignIds.add(de.id);
      matchedRenderedIndices.add(bestRi);
      matches.push({
        designId: de.id,
        renderedIndex: bestRi,
        confidence: Math.min(0.9, 0.5 + bestIou),
        method: "position",
      });
    }
  }

  return matches;
}

// ─── Layer 3: Structure Match ───────────────────────────────

function matchByStructure(
  designElements: DesignElement[],
  renderedElements: RenderedElement[],
  matchedDesignIds: Set<string>,
  matchedRenderedIndices: Set<number>,
): ElementMatch[] {
  const matches: ElementMatch[] = [];

  for (const de of designElements) {
    if (matchedDesignIds.has(de.id)) continue;

    // Match by tag/type similarity and DOM order
    let bestRi = -1;
    let bestScore = 0;

    for (let ri = 0; ri < renderedElements.length; ri++) {
      if (matchedRenderedIndices.has(ri)) continue;
      const re = renderedElements[ri];

      // Score based on similarity of position in tree
      const typeMatch = tagMatchesType(re.tag, de.type) ? 0.3 : 0;
      if (typeMatch > bestScore) {
        bestScore = typeMatch;
        bestRi = ri;
      }
    }

    if (bestRi >= 0) {
      matchedDesignIds.add(de.id);
      matchedRenderedIndices.add(bestRi);
      matches.push({
        designId: de.id,
        renderedIndex: bestRi,
        confidence: 0.5 + bestScore,
        method: "structure",
      });
    }
  }

  return matches;
}

function tagMatchesType(tag: string, type: string): boolean {
  const map: Record<string, string[]> = {
    button: ["button", "a"],
    text: ["p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "label", "li", "a"],
    image: ["img", "svg", "canvas"],
    input: ["input", "select", "textarea"],
    rectangle: ["div", "section", "article", "main", "header", "footer", "nav", "aside"],
    frame: ["div", "section", "article", "main"],
    group: ["div", "span", "section"],
  };
  return map[type]?.includes(tag) ?? false;
}

// ─── Main Entry ─────────────────────────────────────────────

export function matchElements(
  design: DesignSnapshot,
  rendered: RenderedSnapshot,
): ElementMatch[] {
  const matchedDesignIds = new Set<string>();
  const matchedRenderedIndices = new Set<number>();

  // Layer 1: Text
  const textMatches = matchByText(design.elements, rendered.elements, matchedDesignIds, matchedRenderedIndices);

  // Layer 2: Position
  const positionMatches = matchByPosition(design.elements, rendered.elements, matchedDesignIds, matchedRenderedIndices);

  // Layer 3: Structure
  const structureMatches = matchByStructure(design.elements, rendered.elements, matchedDesignIds, matchedRenderedIndices);

  return [...textMatches, ...positionMatches, ...structureMatches];
}
