import { spawn } from "node:child_process";
import {
  MAX_BUFFER_MB_HARD_LIMIT,
  MAX_TIMEOUT_MS_HARD_LIMIT,
} from "../shared.js";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentsProfile } from "../agents-parser.js";
import { detectProjectRoot } from "../project-root.js";

type ParsedCommand = {
  binary: string;
  args: string[];
};

export function parseCommand(cmd: string): ParsedCommand | null {
  const tokens: string[] = [];
  let i = 0;
  const len = cmd.length;

  while (i < len) {
    while (i < len && /\s/.test(cmd[i])) i++;
    if (i >= len) break;

    let token = "";

    if (cmd[i] === '"') {
      i++;
      while (i < len && cmd[i] !== '"') {
        if (cmd[i] === "\\" && i + 1 < len) {
          i++;
          token += cmd[i];
        } else {
          token += cmd[i];
        }
        i++;
      }
      if (i < len) i++;
    } else if (cmd[i] === "'") {
      i++;
      while (i < len && cmd[i] !== "'") {
        token += cmd[i];
        i++;
      }
      if (i < len) i++;
    } else {
      while (i < len && !/\s/.test(cmd[i])) {
        token += cmd[i];
        i++;
      }
    }

    if (token.length > 0) tokens.push(token);
  }

  if (tokens.length === 0) return null;
  return { binary: tokens[0], args: tokens.slice(1) };
}

export async function runCmdWithCwd(
  parsed: ParsedCommand,
  cwd: string,
  maxLines = 200,
  timeoutMs = 30_000,
  maxBufferMb = 10,
): Promise<{ ok: boolean; output: string }> {
  const safeTimeout = Math.min(timeoutMs, MAX_TIMEOUT_MS_HARD_LIMIT);
  const safeMaxBuffer = Math.min(maxBufferMb, MAX_BUFFER_MB_HARD_LIMIT);

  return new Promise((resolvePromise) => {
    const child = spawn(parsed.binary, parsed.args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const maxBytes = safeMaxBuffer * 1024 * 1024;

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < maxBytes) stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < maxBytes) stderr += chunk.toString("utf-8");
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolvePromise({ ok: false, output: stdout || stderr || "timeout" });
    }, safeTimeout);

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      const raw = (code === 0 ? stdout : stderr || stdout).trim();
      const lines = raw.split("\n");
      const truncated = lines.length > maxLines;
      const output = truncated
        ? lines.slice(0, maxLines).join("\n") + "\n⚠️ 输出已截断"
        : raw;
      resolvePromise({ ok: code === 0, output });
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      resolvePromise({ ok: false, output: err.message });
    });
  });
}

interface FingerprintCache {
  fingerprints: string[];
  mtimeMs: number;
}

const fingerprintCache = new Map<string, FingerprintCache>();

export function detectStackFingerprints(root: string): string[] {
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(root).mtimeMs;
  } catch {
    // If statSync fails (e.g. permission or not found), bypass cache lookup by using random time
    mtimeMs = Math.random();
  }

  const cached = fingerprintCache.get(root);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.fingerprints;
  }

  const fingerprints: string[] = [];
  if (existsSync(join(root, "package.json"))) fingerprints.push("nodejs");
  if (existsSync(join(root, "go.mod"))) fingerprints.push("go");
  if (existsSync(join(root, "requirements.txt")) || existsSync(join(root, "pyproject.toml"))) fingerprints.push("python");
  if (existsSync(join(root, "pubspec.yaml"))) fingerprints.push("flutter");
  if (existsSync(join(root, "pom.xml")) || existsSync(join(root, "build.gradle"))) fingerprints.push("java");
  if (existsSync(join(root, "Cargo.toml"))) fingerprints.push("rust");

  // Also merge fingerprints from AGENTS.md if they exist
  try {
    const projRoot = detectProjectRoot(root);
    if (existsSync(join(projRoot, "AGENTS.md"))) {
      const profile = getAgentsProfile();
      if (profile && profile.path === join(projRoot, "AGENTS.md") && Array.isArray(profile.tech_fingerprints)) {
        for (const fp of profile.tech_fingerprints) {
          if (typeof fp === "string" && !fingerprints.includes(fp)) {
            fingerprints.push(fp);
          }
        }
      }
    }
  } catch {
    // ignore profile reading errors
  }

  fingerprintCache.set(root, { fingerprints, mtimeMs });
  return fingerprints;
}
