import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";

type TsDiagnostic = {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
};

function parseTscDiagnostics(output: string, maxDiagnostics: number): TsDiagnostic[] {
  const diags: TsDiagnostic[] = [];
  const lines = output.split(/\r?\n/);

  // tsc typical format:
  // path/to/file.ts(12,34): error TS2345: message...
  const re = /^(.*)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/;

  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    diags.push({
      file: m[1],
      line: Number(m[2]),
      col: Number(m[3]),
      code: m[4],
      message: m[5].trim(),
    });
    if (diags.length >= maxDiagnostics) break;
  }

  return diags;
}

async function runTsc(
  cwd: string,
  tsconfigPath: string,
  timeoutMs: number,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolvePromise) => {
    const args = [
      "--no-install",
      "tsc",
      "--noEmit",
      "--pretty",
      "false",
      "--project",
      tsconfigPath,
    ];

    const child = spawn("npx", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // avoid interactive prompts
        npm_config_yes: "false",
      },
    });

    let stdout = "";
    let stderr = "";
    const maxBytes = 2 * 1024 * 1024;

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < maxBytes) stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < maxBytes) stderr += chunk.toString("utf-8");
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolvePromise({ ok: false, output: stdout || stderr || "timeout" });
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      const out = (code === 0 ? stdout : stderr || stdout).trim();
      resolvePromise({ ok: code === 0, output: out });
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      resolvePromise({ ok: false, output: err.message });
    });
  });
}

export async function ritsu_ts_check(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const tsconfigRel = String(params.tsconfig_path ?? "tsconfig.json").trim() || "tsconfig.json";
  const timeoutMs = Math.min(Number(params.timeout_ms ?? 60_000), 120_000);
  const maxDiagnostics = Math.min(Number(params.max_diagnostics ?? 50), 200);

  const tsconfigAbs = resolve(root, tsconfigRel);
  if (!existsSync(tsconfigAbs)) {
    return errorResult(`tsconfig not found: ${tsconfigAbs}`);
  }

  const r = await runTsc(root, tsconfigAbs, timeoutMs);
  const diagnostics = parseTscDiagnostics(r.output, maxDiagnostics);

  return textResult(
    JSON.stringify({
      passed: r.ok,
      diagnostics,
      diagnostics_count: diagnostics.length,
      tsconfig_path: tsconfigAbs,
      raw_output: r.output.slice(0, 4000),
      truncated: r.output.length > 4000,
    }),
  );
}
