/**
 * ritsu_visual_check — Visual Fidelity Check MCP Tool
 *
 * Merged from fe-sight: renders a URL with Playwright and compares
 * against a design image. Reports pixel diff, style diffs,
 * layout intent mismatches, and content-driven sizing issues.
 *
 * Optional dependency: Playwright (bun add playwright && npx playwright install chromium)
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot, textResult, structuredError } from "./_utils.js";

let pwOk: boolean | null = null;
async function checkPw(): Promise<boolean> {
  if (pwOk !== null) return pwOk;
  try { await import("playwright"); pwOk = true; }
  catch { pwOk = false; }
  return pwOk;
}

export async function ritsu_visual_check(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  if (!(await checkPw())) {
    return textResult(JSON.stringify({ ok: false, error: "Playwright required", help: "bun add playwright && npx playwright install chromium" }));
  }

  const url = String(params.url ?? "");
  const designImage = params.design_image ? String(params.design_image) : undefined;
  if (!url) return structuredError("ValidationError", "URL_REQUIRED", "url is required");
  if (!designImage) return structuredError("ValidationError", "DESIGN_REQUIRED", "design_image is required");

  const root = getProjectRoot();
  const imgPath = resolve(designImage);
  if (!existsSync(imgPath)) return structuredError("ValidationError", "FILE_NOT_FOUND", `Design file not found: ${designImage}`);

  // Capture
  const { captureUrl } = await import("../visual/render-capture.js");
  const capture = await captureUrl(url, {
    viewport: { width: Number(params.viewport_width ?? 1440), height: Number(params.viewport_height ?? 900) },
    projectRoot: root,
    force: params.force === true,
  });
  if (!capture.ok) return textResult(JSON.stringify({ ok: false, error: capture.error }));

  // Read design image and run fidelity check
  const designBuffer = readFileSync(imgPath);
  const { runFidelityCheck } = await import("../visual/fidelity-engine/index.js");
  const report = runFidelityCheck({
    designScreenshot: designBuffer,
    renderedSnapshot: capture.snapshot,
    styleSystem: "css",
  });

  return textResult(JSON.stringify({
    ok: true,
    score: report.score,
    pixel_diff_pct: report.pixelDiffPct,
    style_issues: {
      critical: report.styleDiffs.filter((d) => d.severity === "critical").length,
      major: report.styleDiffs.filter((d) => d.severity === "major").length,
      minor: report.styleDiffs.filter((d) => d.severity === "minor").length,
    },
    capture_id: capture.capture_id,
  }, null, 2));
}
