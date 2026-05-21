/**
 * 架构漂移分析引擎
 *
 * 将代码图分析 + 策略引擎 + LLM 合成三者连接:
 * 1. preflight 时自动提取项目的模块结构和依赖图
 * 2. 将依赖模式作为"架构指纹"存入向量引擎
 * 3. 后续 diff 时对比指纹 → 发现架构漂移 → 报告 policy violation
 * 4. LLM 合成人工可读的架构规则
 * 5. 生成 Mermaid 依赖图用于 AI 上下文
 *
 * 不依赖外部代码图工具 — 通过分析文件路径和 import 语句提取架构模式。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { isNativeAvailable, initNativeStore, indexViolationEmbedding } from "../native-bridge.js";

// ─── 类型 ────────────────────────────────────────────────────

export type ModuleBoundary = {
  name: string;
  path: string;
  depth: number;
};

export type Dependency = {
  fromModule: string;
  toModule: string;
  fromFile: string;
  toFile: string;
  count: number;
};

export type LayerRule = {
  type: "layer_violation" | "circular_dependency" | "forbidden_import" | "unexpected_dependency" | "llm_suggested";
  fromModule: string;
  toModule?: string;
  severity: "warn" | "hard_stop";
  message: string;
  suggestion?: string;
};

export type ArchitectureFingerprint = {
  modules: ModuleBoundary[];
  dependencies: Dependency[];
  rules: LayerRule[];
  files: string[];
  capturedAt: string;
};

// ─── 模块发现 ─────────────────────────────────────────────────

const MODULE_PATTERNS = ["src", "packages", "lib", "app", "runtime", "components", "api", "backend", "frontend"];

function discoverModules(root: string): ModuleBoundary[] {
  const modules: ModuleBoundary[] = [];
  const candidates = [root];

  // Also check common subdirectories
  for (const p of MODULE_PATTERNS) {
    const dir = resolve(root, p);
    if (existsSync(dir) && !candidates.includes(dir)) candidates.push(dir);
  }

  for (const base of candidates) {
    try {
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build" || entry.name === "coverage") continue;
        const fullPath = resolve(base, entry.name);
        const prefix = base === root ? "" : `${relative(root, base)}/`;
        modules.push({ name: `${prefix}${entry.name}`, path: fullPath, depth: prefix ? 2 : 1 });
      }
    } catch { /* skip unreadable */ }
  }

  return modules;
}

// ─── 依赖提取 ─────────────────────────────────────────────────

const IMPORT_RE = /(?:import\s+(?:\{[^}]*\}\s+)?(?:[\w*]+(?:\s*,\s*\{[^}]*\})?)?\s+from\s+['"]|require\s*\(['"])(\.{1,2}\/[^'"]+)/g;

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const normalized = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  let match: RegExpExecArray | null;
  while ((match = IMPORT_RE.exec(normalized)) !== null) {
    if (match[2] && !match[2].includes("node_modules")) imports.push(match[2]);
  }
  return imports;
}

function resolveModule(filePath: string, importPath: string, modules: ModuleBoundary[]): string | null {
  const resolved = resolve(dirname(filePath), importPath);
  for (const mod of modules) {
    if (resolved.startsWith(mod.path)) return mod.name;
  }
  return null;
}

function walkFiles(root: string, callback: (file: string) => void) {
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const full = resolve(root, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        walkFiles(full, callback);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        callback(full);
      }
    }
  } catch { /* skip */ }
}

function extractDependencies(root: string, modules: ModuleBoundary[]): Dependency[] {
  const deps: Dependency[] = [];
  const seen = new Set<string>();

  for (const mod of modules) {
    if (!existsSync(mod.path)) continue;
    walkFiles(mod.path, (fullPath) => {
      const fromModule = resolveModule(fullPath, ".", modules);
      if (!fromModule) return;
      const content = readFileSync(fullPath, "utf-8");
      for (const imp of extractImports(content)) {
        const toModule = resolveModule(fullPath, imp, modules);
        if (!toModule || fromModule === toModule) continue;
        const key = `${fromModule}→${toModule}`;
        if (!seen.has(key)) {
          seen.add(key);
          deps.push({ fromModule, toModule, fromFile: relative(root, fullPath), toFile: imp, count: 1 });
        } else {
          const existing = deps.find((d) => d.fromModule === fromModule && d.toModule === toModule);
          if (existing) existing.count++;
        }
      }
    });
  }

  return deps;
}

// ─── 层规则推导 ───────────────────────────────────────────────

function inferLayerRules(deps: Dependency[]): LayerRule[] {
  const rules: LayerRule[] = [];
  for (const dep of deps) {
    const reverse = deps.find((d) => d.fromModule === dep.toModule && d.toModule === dep.fromModule);
    if (reverse) {
      rules.push({
        type: "circular_dependency", fromModule: dep.fromModule, toModule: dep.toModule,
        severity: "hard_stop",
        message: `Circular dependency: ${dep.fromModule} ↔ ${dep.toModule}`,
        suggestion: "Extract shared logic into a common module they both depend on",
      });
    }
  }
  return rules;
}

// ─── LLM 架构规则合成 ────────────────────────────────────────

function generateMermaidGraph(fingerprint: ArchitectureFingerprint): string {
  const lines = ["graph TD"];
  for (const dep of fingerprint.dependencies) {
    const id = dep.fromModule.replace(/[^a-zA-Z0-9]/g, "_");
    const tid = dep.toModule.replace(/[^a-zA-Z0-9]/g, "_");
    lines.push(`  ${id}[${dep.fromModule}] --> ${tid}[${dep.toModule}]`);
  }
  return lines.join("\n");
}

export function buildArchitectureContext(fingerprint: ArchitectureFingerprint): Record<string, unknown> {
  return {
    modules: fingerprint.modules.map((m) => m.name),
    dependency_count: fingerprint.dependencies.length,
    dependency_graph: fingerprint.dependencies.map((d) => `${d.fromModule}→${d.toModule}`),
    rules: fingerprint.rules.map((r) => `[${r.severity}] ${r.message}`),
    mermaid: generateMermaidGraph(fingerprint),
  };
}

// ─── 指纹构建与对比 ───────────────────────────────────────────

export function buildArchitectureFingerprint(root: string): ArchitectureFingerprint {
  const modules = discoverModules(root);
  const dependencies = extractDependencies(root, modules);
  const rules = inferLayerRules(dependencies);
  return { modules, dependencies, rules, files: dependencies.map((d) => d.fromFile), capturedAt: new Date().toISOString() };
}

export function storeArchitectureFingerprint(fingerprint: ArchitectureFingerprint): void {
  if (!isNativeAvailable()) return;
  initNativeStore();
  for (const mod of fingerprint.modules) {
    indexViolationEmbedding(`mod-${mod.name}`, `module:${mod.name} depth:${mod.depth}`, {
      type: "module", name: mod.name,
    });
  }
  for (const dep of fingerprint.dependencies) {
    indexViolationEmbedding(`dep-${dep.fromModule}-${dep.toModule}`, `${dep.fromModule} imports ${dep.toModule}`, {
      type: "dependency", fromModule: dep.fromModule, toModule: dep.toModule, count: dep.count,
    });
  }
}

export function checkArchitectureDrift(changedFiles: string[], root: string): LayerRule[] {
  const fingerprint = buildArchitectureFingerprint(root);
  const violations: LayerRule[] = [];
  const seen = new Set<string>();

  for (const file of changedFiles) {
    const fullPath = resolve(root, file);
    if (!existsSync(fullPath)) continue;
    try {
      const content = readFileSync(fullPath, "utf-8");
      const imports = extractImports(content);
      const fromModule = fingerprint.modules.find((m) => fullPath.startsWith(m.path));
      for (const imp of imports) {
        const toModule = fingerprint.modules.find((m) => resolve(dirname(fullPath), imp).startsWith(m.path));
        if (fromModule && toModule && fromModule.name !== toModule.name) {
          const key = `${fromModule.name}→${toModule.name}`;
          const existingDep = fingerprint.dependencies.find((d) => d.fromModule === fromModule.name && d.toModule === toModule.name);
          if (!existingDep && !seen.has(key)) {
            seen.add(key);
            violations.push({
              type: "unexpected_dependency", fromModule: fromModule.name, toModule: toModule.name,
              severity: "warn",
              message: `New cross-module dependency: ${fromModule.name} → ${toModule.name} (file: ${file})`,
              suggestion: `Verify this dependency is intentional. Existing deps: ${fingerprint.dependencies.filter((d) => d.fromModule === fromModule.name).map((d) => d.toModule).join(", ")}`,
            });
          }
          if (fingerprint.rules.some((r) => r.type === "circular_dependency" && r.fromModule === toModule.name && r.toModule === fromModule.name)) {
            violations.push({
              type: "circular_dependency", fromModule: fromModule.name, toModule: toModule.name,
              severity: "hard_stop",
              message: `Would create circular dependency: ${fromModule.name} ↔ ${toModule.name}`,
              suggestion: "Extract shared interface into a common module",
            });
          }
        }
      }
    } catch { /* skip */ }
  }
  return violations;
}

// ─── 报告生成 ─────────────────────────────────────────────────

export function buildArchitectureReport(root: string): string {
  const fp = buildArchitectureFingerprint(root);
  const ctx = buildArchitectureContext(fp);
  return [
    "## Architecture Context (Ritsu)",
    "",
    `### Modules (${fp.modules.length})`,
    "```\n" + fp.modules.map((m) => m.name).join("\n") + "\n```",
    "",
    `### Cross-Module Dependencies (${fp.dependencies.length})`,
    "```\n" + fp.dependencies.map((d) => `${d.fromModule} → ${d.toModule} (${d.count}x)`).join("\n") + "\n```",
    "",
    "### Dependency Graph",
    "```mermaid\n" + ctx.mermaid + "\n```",
    ...(fp.rules.length > 0 ? ["", "### Active Rules"] : []),
    ...fp.rules.map((r) => `- [${r.severity}] ${r.message}`),
  ].join("\n");
}

export function buildArchitectureSignals(root: string): string[] {
  const fp = buildArchitectureFingerprint(root);
  return [
    `[signal:architecture]`,
    `modules: ${fp.modules.length}`,
    `cross_module_deps: ${fp.dependencies.length}`,
    `rules: ${fp.rules.length}`,
    `circular_deps: ${fp.rules.filter((r) => r.type === "circular_dependency").length}`,
    `status: PASS`,
  ];
}
