/**
 * ImportGraph — 内存级符号依赖图
 *
 * 消费 AST cache（零 IO）构建双向符号依赖索引:
 * - 哪些文件导出了哪些符号
 * - 哪些文件引用了哪些符号、来自哪个文件
 * - 反向消费者链: 文件 → 直接或间接依赖它的文件
 *
 * CodeGraphDetector 在外部 CLI 不可用时降级到此模块。
 */

import ts from "typescript";
import { existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";

const JS_TS_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function tryResolve(baseDir: string, importPath: string): string | null {
  const exact = resolve(baseDir, importPath);
  if (existsSync(exact)) return exact;

  for (const ext of JS_TS_EXT) {
    const withExt = exact + ext;
    if (existsSync(withExt)) return withExt;
  }

  for (const ext of JS_TS_EXT) {
    const indexFile = resolve(exact, "index" + ext);
    if (existsSync(indexFile)) return indexFile;
  }

  return null;
}

function isProjectFile(absPath: string, root: string): boolean {
  return absPath.startsWith(root) && !absPath.includes("node_modules") && !absPath.includes(".git");
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function getSymbolNameAndType(node: ts.Node): { name: string; type: string } | null {
  const nameNode = (node as { name?: ts.Identifier }).name;
  if (!nameNode || !ts.isIdentifier(nameNode)) return null;
  const name = nameNode.text;

  if (ts.isFunctionDeclaration(node)) return { name, type: "function" };
  if (ts.isClassDeclaration(node)) return { name, type: "class" };
  if (ts.isInterfaceDeclaration(node)) return { name, type: "interface" };
  if (ts.isTypeAliasDeclaration(node)) return { name, type: "type" };
  if (ts.isEnumDeclaration(node)) return { name, type: "enum" };
  return { name, type: "symbol" };
}

export interface AffectedNode {
  id: string;
  name: string;
  file: string;
  type: string;
}

interface ImportEntry {
  sourceFile: string;
  symbols: string[];
}

export class ImportGraph {
  // file → imports from other project files
  private fileImports = new Map<string, ImportEntry[]>();
  // file → its exported symbols
  private fileExports = new Map<string, { name: string; type: string }[]>();
  // symbol name → files that export it
  private symbolIndex = new Map<string, Set<string>>();
  // source file → files that import it (direct consumers)
  private consumers = new Map<string, Set<string>>();

  constructor(
    private astCache: Map<string, { sourceFile: ts.SourceFile; content: string }>,
    private root: string,
  ) {
    this.build();
  }

  // ─── Build ─────────────────────────────────────────────

  private build(): void {
    // Pass 1: collect exports
    for (const [absPath, { sourceFile }] of this.astCache) {
      if (!isProjectFile(absPath, this.root)) continue;
      this.collectExports(absPath, sourceFile);
    }
    // Pass 2: collect imports (needs pass-1 index for re-exports)
    for (const [absPath, { sourceFile }] of this.astCache) {
      if (!isProjectFile(absPath, this.root)) continue;
      this.collectImports(absPath, sourceFile);
    }
  }

  private collectExports(absPath: string, sourceFile: ts.SourceFile): void {
    const exports: { name: string; type: string }[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isExportDeclaration(node)) {
        // export { X }, export { X as Y }, export { X } from './foo'
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const spec of node.exportClause.elements) {
            exports.push({ name: spec.name.text, type: "symbol" });
          }
        }
        return;
      }

      if (hasExportModifier(node)) {
        const info = getSymbolNameAndType(node);
        if (info) exports.push(info);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    this.fileExports.set(absPath, exports);
    for (const exp of exports) {
      if (!this.symbolIndex.has(exp.name)) {
        this.symbolIndex.set(exp.name, new Set());
      }
      this.symbolIndex.get(exp.name)!.add(absPath);
    }
  }

  private collectImports(absPath: string, sourceFile: ts.SourceFile): void {
    const baseDir = dirname(absPath);
    const imports: ImportEntry[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const impPath = node.moduleSpecifier.text;
        if (!impPath.startsWith(".")) return undefined;

        const resolved = tryResolve(baseDir, impPath);
        if (!resolved || !isProjectFile(resolved, this.root)) return undefined;

        const symbols = this.extractImportSymbols(node);
        imports.push({ sourceFile: resolved, symbols });
        this.addConsumer(resolved, absPath);
        return undefined;
      }

      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const impPath = node.moduleSpecifier.text;
        if (!impPath.startsWith(".")) return undefined;

        const resolved = tryResolve(baseDir, impPath);
        if (!resolved || !isProjectFile(resolved, this.root)) return undefined;

        // re-export: both an import and an export
        const symbols: string[] = [];
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const spec of node.exportClause.elements) {
            symbols.push(spec.name.text);
          }
        }
        imports.push({ sourceFile: resolved, symbols });
        this.addConsumer(resolved, absPath);
        return undefined;
      }

      ts.forEachChild(node, visit);
      return undefined;
    };

    visit(sourceFile);
    if (imports.length > 0) {
      this.fileImports.set(absPath, imports);
    }
  }

  private extractImportSymbols(node: ts.ImportDeclaration): string[] {
    const symbols: string[] = [];
    if (!node.importClause) return symbols;

    if (node.importClause.name) {
      symbols.push(node.importClause.name.text);
    }
    if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const spec of node.importClause.namedBindings.elements) {
        symbols.push(spec.name.text);
      }
    }
    return symbols;
  }

  private addConsumer(sourceFile: string, consumerFile: string): void {
    if (!this.consumers.has(sourceFile)) {
      this.consumers.set(sourceFile, new Set());
    }
    this.consumers.get(sourceFile)!.add(consumerFile);
  }

  // ─── Query ─────────────────────────────────────────────

  /**
   * 类似 codegraph affected: 对每个修改的文件，找出
   * 1) 该文件导出的符号
   * 2) 直接引用这些符号的上游文件
   */
  getAffectedBy(changedFiles: string[]): AffectedNode[] {
    const result: AffectedNode[] = [];
    const seen = new Set<string>();

    for (const file of changedFiles) {
      const absFile = resolve(this.root, file);

      // Changed symbols (from the modified file itself)
      const exports = this.fileExports.get(absFile) ?? [];
      for (const exp of exports) {
        const key = `${exp.name}@${exp.type}@${absFile}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ id: exp.name, name: exp.name, file: absFile, type: exp.type });
        }
      }

      // Consumers: files that import symbols from this changed file
      const consumers = this.consumers.get(absFile);
      if (consumers) {
        for (const consumerFile of consumers) {
          const imported = this.getImportedSymbols(consumerFile, absFile);
          for (const sym of imported) {
            const key = `${sym}@consumer@${consumerFile}`;
            if (!seen.has(key)) {
              seen.add(key);
              result.push({ id: sym, name: sym, file: consumerFile, type: "symbol" });
            }
          }
        }
      }
    }

    return result;
  }

  private getImportedSymbols(consumerFile: string, sourceFile: string): string[] {
    const entries = this.fileImports.get(consumerFile);
    if (!entries) return [];
    const found = entries.find((e) => e.sourceFile === sourceFile);
    return found ? found.symbols : [];
  }

  /**
   * BFS 展开所有直接或间接依赖这些文件的上游文件
   */
  getConsumerFiles(files: string[]): string[] {
    const expanded = new Set(files);
    const queue = [...files];

    while (queue.length > 0) {
      const file = queue.pop()!;
      const consumers = this.consumers.get(file);
      if (!consumers) continue;

      for (const consumer of consumers) {
        if (!expanded.has(consumer)) {
          expanded.add(consumer);
          queue.push(consumer);
        }
      }
    }

    return [...expanded];
  }

  /** 获取文件导出的符号列表 */
  getExports(file: string): { name: string; type: string }[] {
    return this.fileExports.get(resolve(this.root, file)) ?? [];
  }

  /** 获取引用指定文件的所有直接消费者 */
  getDirectConsumers(file: string): string[] {
    const consumers = this.consumers.get(resolve(this.root, file));
    return consumers ? [...consumers] : [];
  }
}
