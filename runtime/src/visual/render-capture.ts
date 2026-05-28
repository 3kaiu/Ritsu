/**
 * fe-sight — Render Capture
 *
 * Renders a URL with Playwright and saves the result to disk:
 *   .ritsu/captures/{capture_id}/
 *     screenshot.png   — full page PNG
 *     dom.json         — DOM tree with computed styles
 *     meta.json        — URL, viewport, timestamp
 *
 * This decouples "rendering" from "comparing" so that:
 *   - AI fixes CSS → re-capture (~3s) → compare (~0.5s)
 *   - One capture can be compared against multiple designs
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import type { RenderedElement, RenderedSnapshot } from "./types.js";

// ─── In-browser DOM extraction (runs inside page.evaluate) ────

function extractDomTree(): RenderedElement[] {
  const CSS_PROPS = [
    "font-size", "font-weight", "font-family", "line-height", "letter-spacing",
    "color", "background-color", "border-color",
    "padding", "margin",
    "border-width", "border-radius",
    "width", "height",
    "display", "flex-direction", "align-items", "justify-content",
    "box-shadow", "opacity", "gap", "text-align",
    "grid-template-columns", "grid-template-rows",
  ];
  const EXCLUDED_TAGS = new Set(["script", "style", "link", "meta", "noscript", "br", "hr"]);
  const SIGNIFICANT_TAGS = new Set([
    "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "a", "button", "input", "select", "textarea", "label",
    "img", "svg", "ul", "ol", "li", "table", "tr", "td", "th",
    "header", "footer", "nav", "main", "section", "article", "aside",
    "form", "blockquote", "pre", "code",
    "small", "strong", "em", "i", "b", "u",
  ]);

  function extractStyle(el: Element): Record<string, string> {
    const computed = window.getComputedStyle(el);
    const styles: Record<string, string> = {};
    for (const prop of CSS_PROPS as unknown as string[]) {
      try { const v = computed.getPropertyValue(prop); if (v) styles[prop] = v; } catch { /* skip */ }
    }
    return styles;
  }

  function getText(el: Element): string | undefined {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.placeholder || el.value || undefined;
    if (el instanceof HTMLButtonElement) return el.textContent?.trim() || undefined;
    if (el.childNodes.length === 1 && el.childNodes[0].nodeType === Node.TEXT_NODE) {
      const t = (el.childNodes[0] as Text).wholeText.trim();
      if (t) return t;
    }
    const t = (el as HTMLElement).innerText?.trim();
    if (t && t.length < 200) return t;
    return undefined;
  }

  function isVisible(el: Element): boolean {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.width > 5000) return false;
    const c = window.getComputedStyle(el);
    if (c.display === "none" || c.visibility === "hidden" || parseFloat(c.opacity) === 0) return false;
    return true;
  }

  function walk(el: Element): RenderedElement | null {
    const tag = el.tagName.toLowerCase();
    if (EXCLUDED_TAGS.has(tag)) return null;
    if (!SIGNIFICANT_TAGS.has(tag) && el.children.length === 0) return null;
    if (!isVisible(el)) return null;
    const rect = el.getBoundingClientRect();
    const styles = extractStyle(el);
    const text = getText(el);
    const children: RenderedElement[] = [];
    for (let i = 0; i < el.children.length; i++) {
      const child = walk(el.children[i]);
      if (child) children.push(child);
    }
    const attrs: Record<string, string> = {};
    for (const a of ["class", "id", "type", "role", "aria-label", "placeholder", "alt", "src", "href"]) {
      const v = el.getAttribute(a);
      if (v) attrs[a] = v;
    }
    return {
      tag, text,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      styles, attributes: attrs,
      children: children.length > 0 ? children : undefined,
    };
  }

  const results: RenderedElement[] = [];
  const body = document.body;
  if (body) for (let i = 0; i < body.children.length; i++) { const c = walk(body.children[i]); if (c) results.push(c); }
  return results;
}

// ─── Types ────────────────────────────────────────────────────

export interface CaptureMeta {
  capture_id: string;
  url: string;
  viewport: { width: number; height: number };
  timestamp: string;
  element_count: number;
}

export interface CaptureResult {
  ok: true;
  capture_id: string;
  meta: CaptureMeta;
  snapshot: RenderedSnapshot;
}

export interface CaptureError {
  ok: false;
  error: string;
}

// ─── Capture Directory ────────────────────────────────────────

function getCaptureDir(projectRoot: string): string {
  return resolve(projectRoot, ".ritsu", "captures");
}

function captureHash(url: string, viewport: string): string {
  return createHash("sha256").update(`${url}|${viewport}`).digest("hex").slice(0, 12);
}

function capturePath(projectRoot: string, captureId: string): string {
  return resolve(getCaptureDir(projectRoot), captureId);
}

// ─── Render & Save ────────────────────────────────────────────

export async function captureUrl(
  url: string,
  options: {
    viewport?: { width: number; height: number };
    projectRoot?: string;
    force?: boolean;
  } = {},
): Promise<CaptureResult | CaptureError> {
  const viewport = options.viewport ?? { width: 1440, height: 900 };
  const projectRoot = options.projectRoot ?? process.cwd();
  const captureId = captureHash(url, `${viewport.width}x${viewport.height}`);
  const dir = capturePath(projectRoot, captureId);

  // Return cached if exists
  if (!options.force && existsSync(dir)) {
    try {
      const metaRaw = readFileSync(resolve(dir, "meta.json"), "utf-8");
      const meta = JSON.parse(metaRaw) as CaptureMeta;
      const domRaw = readFileSync(resolve(dir, "dom.json"), "utf-8");
      const elements = JSON.parse(domRaw) as RenderedElement[];
      const screenshot = readFileSync(resolve(dir, "screenshot.png"));
      return {
        ok: true,
        capture_id: captureId,
        meta,
        snapshot: { elements, screenshot, width: viewport.width, height: viewport.height },
      };
    } catch {
      // Cache invalid, re-capture
    }
  }

  // Render
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1000);

    const screenshot = await page.screenshot({ fullPage: true, type: "png" });
    const elements = await page.evaluate(extractDomTree);

    const meta: CaptureMeta = {
      capture_id: captureId,
      url,
      viewport,
      timestamp: new Date().toISOString(),
      element_count: elements.length,
    };

    // Save to disk
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "screenshot.png"), screenshot);
    writeFileSync(resolve(dir, "dom.json"), JSON.stringify(elements, null, 2));
    writeFileSync(resolve(dir, "meta.json"), JSON.stringify(meta, null, 2));

    return {
      ok: true,
      capture_id: captureId,
      meta,
      snapshot: {
        elements,
        screenshot: Buffer.from(screenshot),
        width: viewport.width,
        height: viewport.height,
      },
    };
  } catch (err) {
    return { ok: false, error: `Capture failed: ${(err as Error).message}` };
  } finally {
    await browser.close();
  }
}

// ─── Read Capture ─────────────────────────────────────────────

export function readCapture(
  captureId: string,
  projectRoot?: string,
): { meta: CaptureMeta; snapshot: RenderedSnapshot } | null {
  const root = projectRoot ?? process.cwd();
  const dir = capturePath(root, captureId);
  if (!existsSync(dir)) return null;

  try {
    const metaRaw = readFileSync(resolve(dir, "meta.json"), "utf-8");
    const meta = JSON.parse(metaRaw) as CaptureMeta;
    const domRaw = readFileSync(resolve(dir, "dom.json"), "utf-8");
    const elements = JSON.parse(domRaw) as RenderedElement[];
    const screenshot = readFileSync(resolve(dir, "screenshot.png"));
    return {
      meta,
      snapshot: { elements, screenshot, width: meta.viewport.width, height: meta.viewport.height },
    };
  } catch {
    return null;
  }
}
