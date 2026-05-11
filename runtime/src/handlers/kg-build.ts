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
  engine: "regex" | "ts-ast";
  root: string;
  files: string[];
  edges: KgEdge[];
  symbols: SymbolDef[];
};

type TsPathMapping = {
  pattern: string;
  prefix: string;
  suffix: string;
  targets: string[];
};

type TsImportResolver = {
  baseUrlAbs: string;
  mappings: TsPathMapping[];
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

function readTsImportResolver(root: string): TsImportResolver | null {
  const tsconfigPath = resolve(root, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return null;

  try {
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8")) as any;
    const compilerOptions = tsconfig?.compilerOptions ?? {};
    const baseUrlRel = String(compilerOptions.baseUrl ?? ".");
    const baseUrlAbs = resolve(root, baseUrlRel);
    const paths = compilerOptions.paths ?? {};

    const mappings: TsPathMapping[] = [];
    for (const [pattern, arr] of Object.entries(paths)) {
      if (typeof pattern !== "string") continue;
      if (!Array.isArray(arr)) continue;

      const starIdx = pattern.indexOf("*");
      const prefix = starIdx >= 0 ? pattern.slice(0, starIdx) : pattern;
      const suffix = starIdx >= 0 ? pattern.slice(starIdx + 1) : "";
      const targets = (arr as any[]).filter(
        (x) => typeof x === "string",
      ) as string[];
      if (targets.length === 0) continue;

      mappings.push({ pattern, prefix, suffix, targets });
    }

    return { baseUrlAbs, mappings };
  } catch {
    return null;
  }
}

function resolveWithCandidates(base: string): string | null {
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

function resolveImport(
  fromFile: string,
  spec: string,
  resolver: TsImportResolver | null,
): string | null {
  if (spec.startsWith(".")) {
    const base = resolve(dirname(fromFile), spec);
    return resolveWithCandidates(base);
  }

  // TS path alias support (tsconfig baseUrl/paths)
  if (resolver && resolver.mappings.length > 0) {
    for (const m of resolver.mappings) {
      if (!spec.startsWith(m.prefix) || !spec.endsWith(m.suffix)) continue;
      const captured = spec.slice(
        m.prefix.length,
        spec.length - m.suffix.length,
      );
      for (const target of m.targets) {
        const resolvedTarget = target.includes("*")
          ? target.replace("*", captured)
          : target;
        const base = resolve(resolver.baseUrlAbs, resolvedTarget);
        const hit = resolveWithCandidates(base);
        if (hit) return hit;
      }
    }
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

async function tryLoadTypeScript(): Promise<any | null> {
  try {
    const mod = await import("typescript");
    return (mod as any).default ?? mod;
  } catch {
    return null;
  }
}

function isTsExported(node: any, ts: any): boolean {
  const modifiers = node.modifiers as any[] | undefined;
  if (!modifiers) return false;
  return modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function tsKindToSymbolKind(kind: number, ts: any): SymbolDef["kind"] | null {
  switch (kind) {
    case ts.SyntaxKind.FunctionDeclaration:
      return "function";
    case ts.SyntaxKind.ClassDeclaration:
      return "class";
    case ts.SyntaxKind.InterfaceDeclaration:
      return "interface";
    case ts.SyntaxKind.TypeAliasDeclaration:
      return "type";
    case ts.SyntaxKind.EnumDeclaration:
      return "enum";
    case ts.SyntaxKind.VariableStatement:
      return "const";
    default:
      return null;
  }
}

function extractSymbolDefsTsAst(
  content: string,
  fileRel: string,
  ts: any,
): SymbolDef[] {
  const out: SymbolDef[] = [];
  const sf = ts.createSourceFile(
    fileRel,
    content,
    ts.ScriptTarget.Latest,
    false,
  );

  for (const st of sf.statements) {
    const k = tsKindToSymbolKind(st.kind, ts);
    if (!k) continue;

    if (st.kind === ts.SyntaxKind.VariableStatement) {
      if (!isTsExported(st, ts)) continue;
      for (const decl of st.declarationList.declarations ?? []) {
        const name = decl.name?.text;
        if (typeof name === "string" && name) {
          out.push({ name, kind: "const", file: fileRel });
        }
      }
      continue;
    }

    if (!isTsExported(st, ts)) continue;
    const name = (st.name && st.name.text) || "";
    if (name) out.push({ name, kind: k, file: fileRel });
  }

  return out;
}

function extractSymbolRefsTsAst(
  content: string,
  fileRel: string,
  ts: any,
): string[] {
  const tokens = new Set<string>();
  const sf = ts.createSourceFile(
    fileRel,
    content,
    ts.ScriptTarget.Latest,
    false,
  );

  function visit(n: any) {
    if (n.kind === ts.SyntaxKind.Identifier) {
      const t = n.text as string;
      if (typeof t === "string" && t.length >= 3) tokens.add(t);
    }
    ts.forEachChild(n, visit);
  }

  visit(sf);
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

  const tsResolver = readTsImportResolver(root);
  const ts = await tryLoadTypeScript();
  const engine: Kg["engine"] = ts ? "ts-ast" : "regex";

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

    const defs = ts
      ? extractSymbolDefsTsAst(content, rel, ts)
      : extractSymbolDefs(content, rel);
    for (const d of defs) {
      symbols.push(d);
      if (!symbolToFile.has(d.name)) symbolToFile.set(d.name, d.file);
    }

    const imports = extractImports(content);
    for (const spec of imports) {
      const resolved = resolveImport(abs, spec, tsResolver);
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

    const refs = ts
      ? extractSymbolRefsTsAst(content, rel, ts)
      : extractSymbolRefs(content);
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
    engine,
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
