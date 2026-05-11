import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { getProjectRoot, errorResult, textResult } from "./_utils.js";
import { readTsImportResolver, resolveImport } from "./_ts-resolve-utils.js";
import { runRg, parseRgFilePaths } from "./_rg-utils.js";

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

function nowIso(): string {
  return new Date().toISOString();
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
      const resolved = resolveImport(dirname(abs), spec, tsResolver);
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
