import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { getProjectRoot, textResult, errorResult } from "./_utils.js";

type Location = {
  file: string;
  line: number;
  col: number;
};

type SymbolDefinition = {
  name: string;
  kind: string;
  location: Location;
  signature?: string;
  type?: string;
};

type SymbolReference = {
  location: Location;
  context: string;
};

function posToLoc(sf: ts.SourceFile, pos: number): Location {
  const lc = sf.getLineAndCharacterOfPosition(pos);
  return {
    file: sf.fileName,
    line: lc.line + 1,
    col: lc.character + 1,
  };
}

function getNodeTextSnippet(
  sf: ts.SourceFile,
  start: number,
  end: number,
): string {
  const s = Math.max(0, start);
  const e = Math.min(sf.text.length, end);
  return sf.text.slice(s, e).replace(/\s+/g, " ").trim();
}

function defaultHostForConfig(root: string): ts.ParseConfigHost {
  return {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readDirectory: ts.sys.readDirectory,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    trace: () => {},
    getCurrentDirectory: () => root,
  };
}

function loadProgramFromTsconfig(
  root: string,
  tsconfigAbs: string,
): { program: ts.Program; checker: ts.TypeChecker } {
  const configFile = ts.readConfigFile(tsconfigAbs, ts.sys.readFile);
  if (configFile.error) {
    const msg = ts.flattenDiagnosticMessageText(
      configFile.error.messageText,
      "\n",
    );
    throw new Error(`failed to read tsconfig: ${msg}`);
  }

  const configDir = dirname(tsconfigAbs);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    defaultHostForConfig(configDir),
    configDir,
    {
      noEmit: true,
      skipLibCheck: true,
    },
    tsconfigAbs,
  );

  const fileNames = parsed.fileNames.filter((f) => {
    const norm = f.replace(/\\/g, "/");
    if (norm.includes("/node_modules/")) return false;
    if (norm.includes("/dist/")) return false;
    if (norm.includes("/.git/")) return false;
    return true;
  });

  const program = ts.createProgram({
    rootNames: fileNames,
    options: parsed.options,
  });
  const checker = program.getTypeChecker();
  return { program, checker };
}

function describeSignature(
  checker: ts.TypeChecker,
  decl: ts.Declaration,
): { signature?: string; type?: string } {
  try {
    const type = checker.getTypeAtLocation(decl);
    const typeStr = checker.typeToString(type);

    // For functions/methods, prefer call signatures.
    const sigs = checker.getSignaturesOfType(type, ts.SignatureKind.Call);
    if (sigs.length > 0) {
      const sigText = checker.signatureToString(sigs[0]);
      return { signature: sigText, type: typeStr };
    }

    return { type: typeStr };
  } catch {
    return {};
  }
}

function isDeclarationName(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return false;
  return (
    ts.isFunctionDeclaration(p) ||
    ts.isClassDeclaration(p) ||
    ts.isInterfaceDeclaration(p) ||
    ts.isTypeAliasDeclaration(p) ||
    ts.isEnumDeclaration(p) ||
    ts.isVariableDeclaration(p) ||
    ts.isParameter(p) ||
    ts.isMethodDeclaration(p) ||
    ts.isPropertyDeclaration(p)
  );
}

function nodeKind(n: ts.Node): string {
  return ts.SyntaxKind[n.kind] ?? String(n.kind);
}

export async function ritsu_ts_symbol_query(
  params: Record<string, unknown>,
): Promise<CallToolResult> {
  const root = getProjectRoot();
  const symbol = String(params.symbol ?? "").trim();
  const tsconfigRel =
    String(params.tsconfig_path ?? "tsconfig.json").trim() || "tsconfig.json";
  const fileHint = String(params.file_hint ?? "").trim();

  const maxDefinitions = Math.min(Number(params.max_definitions ?? 10), 50);
  const maxReferences = Math.min(Number(params.max_references ?? 20), 200);

  if (!symbol) return errorResult("symbol is required");

  const tsconfigAbs = resolve(root, tsconfigRel);
  if (!existsSync(tsconfigAbs)) {
    return errorResult(`tsconfig not found: ${tsconfigAbs}`);
  }

  let program: ts.Program;
  let checker: ts.TypeChecker;
  try {
    ({ program, checker } = loadProgramFromTsconfig(root, tsconfigAbs));
  } catch (e: any) {
    return errorResult(e?.message ?? String(e));
  }

  const sourceFiles = program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile)
    .filter((sf) => {
      const norm = sf.fileName.replace(/\\/g, "/");
      if (norm.includes("/node_modules/")) return false;
      if (norm.includes("/dist/")) return false;
      if (norm.includes("/.git/")) return false;
      if (fileHint) {
        const hintNorm = resolve(root, fileHint).replace(/\\/g, "/");
        return norm === hintNorm;
      }
      return true;
    });

  const definitions: SymbolDefinition[] = [];
  const references: SymbolReference[] = [];

  const visit = (sf: ts.SourceFile, n: ts.Node) => {
    if (ts.isIdentifier(n) && n.text === symbol) {
      const loc = posToLoc(sf, n.getStart(sf));

      if (isDeclarationName(n)) {
        const decl = n.parent as ts.Declaration;
        const info = describeSignature(checker, decl);
        definitions.push({
          name: symbol,
          kind: nodeKind(decl),
          location: loc,
          signature: info.signature,
          type: info.type,
        });
      } else {
        const ctx = getNodeTextSnippet(
          sf,
          Math.max(0, n.getStart(sf) - 60),
          n.getEnd() + 60,
        );
        references.push({ location: loc, context: ctx });
      }
    }

    ts.forEachChild(n, (c) => visit(sf, c));
  };

  for (const sf of sourceFiles) {
    if (
      definitions.length >= maxDefinitions &&
      references.length >= maxReferences
    )
      break;
    visit(sf, sf);
  }

  return textResult(
    JSON.stringify({
      symbol,
      tsconfig_path: tsconfigAbs,
      file_hint: fileHint || null,
      definitions: definitions.slice(0, maxDefinitions),
      references: references.slice(0, maxReferences),
      definitions_count: definitions.length,
      references_count: references.length,
    }),
  );
}
