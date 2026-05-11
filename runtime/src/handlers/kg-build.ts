import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { spawn } from "node:child_process";
import { getProjectRoot, errorResult, textResult } from "./_utils.js";

type EdgeType = "imports" | "references";

type KgEdge = {
  from: string;
  to: string;
  type: EdgeType;
};

type SymbolDef = {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "enum" | "const";
  file: string;
};

type Kg = {
  version: "0.1";
  generated_at: string;
  root: string;
  files: string[];
  edges: KgEdge[];
  symbols: SymbolDef[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function runRg(
  pattern: string,
  cwd: string,
  globs: string[] = [],
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolvePromise) => {
    const args = [
      "--no-heading",
      "--line-number",
      "--color",
      "never",
      pattern,
      ".",
    ];
    for (const g of globs) args.unshift("--glob", g);

    const child = spawn("rg", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const maxBytes = 10 * 1024 * 1024;
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < maxBytes) stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < maxBytes) stderr += chunk.toString("utf-8");
    });
    child.on("close", (code) => {
      resolvePromise({
        ok: code === 0 || code === 1,
        output: (code === 0 || code === 1 ? stdout : stderr || stdout).trim(),
      });
    });
    child.on("error", (err) =>
      resolvePromise({ ok: false, output: err.message }),
    );
  });
}

function parseRgFilePaths(output: string): string[] {
  const files = new Set<string>();
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(/^([^:]+):\d+:/);
    if (m) files.add(m[1]);
  }
  return Array.from(files);
}

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    resolve(base, "index.ts"),
    resolve(base, "index.tsx"),
    resolve(base, "index.js"),
    resolve(base, "index.jsx"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function extractImports(content: string): string[] {
  const specs = new Set<string>();
  for (const m of content.matchAll(
    /\bimport\s+[^;]*?from\s+["']([^"']+)["']/g,
  )) {
    specs.add(m[1]);
  }
  for (const m of content.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    specs.add(m[1]);
  }
  for (const m of content.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
    specs.add(m[1]);
  }
  return Array.from(specs);
}

function extractSymbolDefs(content: string, fileRel: string): SymbolDef[] {
  const out: SymbolDef[] = [];
  for (const m of content.matchAll(/\bexport\s+function\s+(\w+)/g)) {
    out.push({ name: m[1], kind: "function", file: fileRel });
  }
  for (const m of content.matchAll(/\bexport\s+class\s+(\w+)/g)) {
    out.push({ name: m[1], kind: "class", file: fileRel });
  }
  for (const m of content.matchAll(/\bexport\s+interface\s+(\w+)/g)) {
    out.push({ name: m[1], kind: "interface", file: fileRel });
  }
  for (const m of content.matchAll(/\bexport\s+type\s+(\w+)/g)) {
    out.push({ name: m[1], kind: "type", file: fileRel });
  }
  for (const m of content.matchAll(/\bexport\s+enum\s+(\w+)/g)) {
    out.push({ name: m[1], kind: "enum", file: fileRel });
  }
  for (const m of content.matchAll(/\bexport\s+const\s+(\w+)/g)) {
    out.push({ name: m[1], kind: "const", file: fileRel });
  }
  return out;
}

function extractSymbolRefs(content: string): string[] {
  const tokens = new Set<string>();
  for (const m of content.matchAll(/\b[A-Z][A-Za-z0-9_]{2,}\b/g)) {
    tokens.add(m[0]);
  }
  for (const m of content.matchAll(/\buse[A-Z][A-Za-z0-9_]{2,}\b/g)) {
    tokens.add(m[0]);
  }
  return Array.from(tokens);
}

export async function ritsu_build_kg(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const maxFiles = Math.max(
    50,
    Math.min(5000, Number(params.max_files ?? 2000)),
  );

  const rgR = await runRg("(export\\s+|import\\s+|require\\()", root, [
    "*.ts",
    "*.tsx",
    "*.js",
    "*.jsx",
    "!**/node_modules/**",
    "!**/dist/**",
    "!**/.git/**",
    "!**/.ritsu/**",
  ]);
  if (!rgR.ok) return errorResult(`rg scan failed: ${rgR.output}`);

  const fileRelPaths = parseRgFilePaths(rgR.output).slice(0, maxFiles);
  const fileAbsPaths = fileRelPaths.map((p) => resolve(root, p));

  const symbols: SymbolDef[] = [];
  const symbolToFile = new Map<string, string>();
  const edges: KgEdge[] = [];

  for (let i = 0; i < fileAbsPaths.length; i++) {
    const abs = fileAbsPaths[i];
    if (!existsSync(abs)) continue;
    const rel = relative(root, abs);
    const content = readFileSync(abs, "utf-8");

    const defs = extractSymbolDefs(content, rel);
    for (const d of defs) {
      symbols.push(d);
      if (!symbolToFile.has(d.name)) symbolToFile.set(d.name, d.file);
    }

    const imports = extractImports(content);
    for (const spec of imports) {
      const resolved = resolveImport(abs, spec);
      if (!resolved) continue;
      const toRel = relative(root, resolved);
      edges.push({ from: rel, to: toRel, type: "imports" });
    }
  }

  // Second pass: references edges by symbol name
  for (let i = 0; i < fileAbsPaths.length; i++) {
    const abs = fileAbsPaths[i];
    if (!existsSync(abs)) continue;
    const rel = relative(root, abs);
    const content = readFileSync(abs, "utf-8");

    const refs = extractSymbolRefs(content);
    for (const r of refs) {
      const defFile = symbolToFile.get(r);
      if (!defFile) continue;
      if (defFile === rel) continue;
      edges.push({ from: rel, to: defFile, type: "references" });
    }
  }

  const kg: Kg = {
    version: "0.1",
    generated_at: nowIso(),
    root,
    files: fileRelPaths,
    edges,
    symbols,
  };

  const outPath = resolve(root, ".ritsu", "kg.json");
  mkdirSync(resolve(root, ".ritsu"), { recursive: true });
  writeFileSync(outPath, JSON.stringify(kg), "utf-8");

  return textResult(
    JSON.stringify({
      written: true,
      path: outPath,
      files_total: kg.files.length,
      symbols_total: kg.symbols.length,
      edges_total: kg.edges.length,
      generated_at: kg.generated_at,
    }),
  );
}
