/**
 * fe-sight — Pixel Diff
 *
 * Compares two images pixel by pixel and produces:
 * - Overall fidelity score (0-100)
 * - Number of differing pixels
 * - Visual diff image (for display/debugging)
 *
 * Uses pixelmatch for the heavy lifting.
 */

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface PixelDiffResult {
  score: number;         // 0-100, 100 = identical
  diffPixels: number;
  totalPixels: number;
  diffPct: number;       // 0-100, percentage of pixels that differ
}

/**
 * Compare a design PNG against a rendered PNG.
 * Both images must be the same dimensions.
 */
export function pixelDiff(
  designBuffer: Buffer,
  renderedBuffer: Buffer,
): PixelDiffResult {
  const designPng = PNG.sync.read(designBuffer);
  const renderedPng = PNG.sync.read(renderedBuffer);

  const width = Math.min(designPng.width, renderedPng.width);
  const height = Math.min(designPng.height, renderedPng.height);
  const totalPixels = width * height;

  const diff = new PNG({ width, height });

  const diffPixels = pixelmatch(
    designPng.data,
    renderedPng.data,
    diff.data,
    width,
    height,
    { threshold: 0.1, alpha: 0.3 },
  );

  const diffPct = totalPixels > 0 ? (diffPixels / totalPixels) * 100 : 0;
  const score = Math.max(0, Math.round(100 - diffPct));

  return { score, diffPixels, totalPixels, diffPct };
}

/**
 * Generate a visual diff image as a data URL for display.
 */
export function generateDiffImage(
  designBuffer: Buffer,
  renderedBuffer: Buffer,
): Buffer | null {
  try {
    const designPng = PNG.sync.read(designBuffer);
    const renderedPng = PNG.sync.read(renderedBuffer);
    const width = Math.min(designPng.width, renderedPng.width);
    const height = Math.min(designPng.height, renderedPng.height);
    const diff = new PNG({ width, height });

    pixelmatch(
      designPng.data,
      renderedPng.data,
      diff.data,
      width,
      height,
      { threshold: 0.1, alpha: 0.3 },
    );

    return PNG.sync.write(diff);
  } catch {
    return null;
  }
}
