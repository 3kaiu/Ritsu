/**
 * Blast Radius — 传递依赖展开
 *
 * 在 AST cache 预热后，构建反向依赖索引（谁 import 了谁），
 * 对每个修改文件做 BFS 展开，找出所有传递依赖的上游消费者，
 * 自动扩展 scan_files 以避免漏检波及文件。
 *
 * 纯函数设计：失败时返回原始列表，不中断调用方。
 */

import ts from "typescript";
import { existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";

const IMPORT_RE = /(?:import\s+(?:\{[^}]*\}\s+)?(?:[\w*]+(?:\s*,\s*\{[^}]*\})?)?\s+from\s+['"]|require\s*\(['"]|import\s+['"])(\.{1,2}\/[^'"]+)/g;

const JS_TS_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function extractRelativeImports(content: string): string[] {
  const imports: string[] = [];
  const normalized = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  let match: RegExpExecArray | null;
  while ((match = IMPORT_RE.exec(normalized)) !== null) {
    if (match[1]) imports.push(match[1]);
  }
  return imports;
}

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

/**
 * 从 AST cache 构建反向依赖索引，对每个 (可能在 scan_files 中的) 文件，
 * 通过 BFS 展开所有传递上游消费者，确保波及文件不被遗漏。
 *
 * @param scanFiles  原始修改文件列表（相对路径）
 * @param root       项目根目录
 * @param astCache   已预热的 AST 缓存（SourceFile + content）
 * @returns          展开后的文件列表（相对路径，去重），失败时原样返回
 */
export function expandScanFilesWithBlastRadius(
  scanFiles: string[],
  root: string,
  astCache: Map<string, { sourceFile: ts.SourceFile; content: string }>,
): string[] {
  if (!scanFiles.length || !astCache.size) return scanFiles;

  // 1. 构建反向依赖索引: 被引用文件 → 引用它的文件列表
  const reverseDeps = new Map<string, Set<string>>();

  for (const [absPath, cached] of astCache) {
    if (!isProjectFile(absPath, root)) continue;

    const baseDir = dirname(absPath);
    const imports = extractRelativeImports(cached.content);

    for (const imp of imports) {
      const resolved = tryResolve(baseDir, imp);
      if (resolved && isProjectFile(resolved, root)) {
        if (!reverseDeps.has(resolved)) {
          reverseDeps.set(resolved, new Set());
        }
        reverseDeps.get(resolved)!.add(absPath);
      }
    }
  }

  if (reverseDeps.size === 0) return scanFiles;

  // 2. BFS 展开: 从每个修改文件出发，遍历所有上游消费者
  const initialFiles: string[] = [];
  for (const f of scanFiles) {
    const abs = resolve(root, f);
    if (existsSync(abs) && isProjectFile(abs, root)) {
      initialFiles.push(abs);
    }
  }

  if (initialFiles.length === 0) return scanFiles;

  const expanded = new Set(initialFiles);
  const queue = [...initialFiles];

  while (queue.length > 0) {
    const file = queue.pop()!;
    const consumers = reverseDeps.get(file);
    if (!consumers) continue;

    for (const consumer of consumers) {
      if (!expanded.has(consumer)) {
        expanded.add(consumer);
        queue.push(consumer);
      }
    }
  }

  // 3. 转回相对路径（去重 + 保持原顺序优先）
  const expandedRel = new Set([...scanFiles, ...[...expanded].map((abs) => relative(root, abs))]);
  return [...expandedRel];
}
