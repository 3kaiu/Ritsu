/**
 * E2E integration test for visual fidelity check pipeline.
 *
 * Tests: serve HTML → captureUrl → runFidelityCheck → verify report.
 * Requires Playwright. Skipped if not installed.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

let hasPlaywright = true;
try {
  await import("playwright");
} catch {
  hasPlaywright = false;
}

const describePW = hasPlaywright ? describe : describe.skip;

describePW("ritsu_visual_check E2E", () => {
  let server: { close(): void };
  let serverUrl: string;

  beforeAll(async () => {
    const http = await import("node:http");
    const html = `<!DOCTYPE html><html><head><style>
body { background:#fff; font-family:Arial; margin:40px; }
h1 { font-size:32px; color:#1a1a1a; }
.card { background:#f3f4f6; padding:24px; border-radius:8px; max-width:400px; }
button { background:#2563eb; color:#fff; padding:12px 24px; border:none; border-radius:6px; font-size:16px; margin-top:16px; }
</style></head><body>
<h1>Hello Ritsu</h1>
<div class="card"><p style="font-size:16px;color:#374151;">Test page.</p><button>Click</button></div>
</body></html>`;
    const s = http.default.createServer((_r: any, res: any) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); });
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    const addr = s.address() as { port: number };
    serverUrl = `http://127.0.0.1:${addr.port}`;
    server = { close: () => s.close() };
  });

  afterAll(() => server?.close());

  it("captures page, stores to disk, returns valid elements", async () => {
    const { captureUrl } = await import("../../src/visual/render-capture.js");
    const result: any = await captureUrl(serverUrl, {
      viewport: { width: 800, height: 600 },
      force: true,
    });

    expect(result.ok).toBe(true);
    expect(result.capture_id).toBeTruthy();
    expect(result.snapshot.elements.length).toBeGreaterThan(0);

    const texts = extractTexts(result.snapshot.elements);
    expect(texts.some((t: string) => t.includes("Hello"))).toBe(true);

    const { existsSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    // Check common paths
    const cwd = process.cwd();
    const candidates = [
      resolve(cwd, ".ritsu", "captures", result.capture_id),
      resolve(cwd, "..", ".ritsu", "captures", result.capture_id),
      resolve(cwd, "runtime", ".ritsu", "captures", result.capture_id),
    ];
    const found = candidates.find((d) => existsSync(resolve(d, "screenshot.png")));
    if (!found) {
      console.log("Capture dir not found. CWD:", cwd);
      console.log("Searched:", candidates);
    }
    expect(found).toBeTruthy();
    if (found) {
      expect(existsSync(resolve(found, "dom.json"))).toBe(true);
      expect(existsSync(resolve(found, "meta.json"))).toBe(true);
    }
  }, 30000);

  it("fidelity check runs successfully", async () => {
    const { captureUrl } = await import("../../src/visual/render-capture.js");
    const capture: any = await captureUrl(serverUrl, {
      viewport: { width: 800, height: 600 },
    });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;

    // Use actual screenshot dimensions for the reference PNG
    const { PNG } = await import("pngjs");
    const { readFileSync, existsSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    // Try multiple paths for the screenshot
    const cwd2 = process.cwd();
    const screenCandidates = [
      resolve(cwd2, ".ritsu", "captures", capture.capture_id, "screenshot.png"),
      resolve(cwd2, "..", ".ritsu", "captures", capture.capture_id, "screenshot.png"),
    ];
    const screenPath = screenCandidates.find((p) => existsSync(p)) || "";
    if (screenPath) {
      const screenBuf = readFileSync(screenPath);
      const screenPng = PNG.sync.read(screenBuf);
      const refPng = new PNG({ width: screenPng.width, height: screenPng.height });
      for (let i = 0; i < refPng.data.length; i += 4) { refPng.data[i] = 255; refPng.data[i + 1] = 255; refPng.data[i + 2] = 255; refPng.data[i + 3] = 255; }
      const refBuffer = PNG.sync.write(refPng);

      const { runFidelityCheck } = await import("../../src/visual/fidelity-engine/index.js");
      const report = runFidelityCheck({
        designScreenshot: refBuffer as Buffer,
        renderedSnapshot: capture.snapshot,
        styleSystem: "css",
      });

      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
      expect(typeof report.pixelDiffPct).toBe("number");
      expect(Array.isArray(report.styleDiffs)).toBe(true);
    }
  }, 30000);
});

function extractTexts(elements: any[]): string[] {
  const t: string[] = [];
  for (const e of elements) {
    if (e.text) t.push(e.text);
    if (e.children) t.push(...extractTexts(e.children));
  }
  return t;
}
