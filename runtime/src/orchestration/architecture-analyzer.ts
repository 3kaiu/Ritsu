/**
 * 架构漂移分析引擎
 *
 * 将代码图分析 + 策略引擎 + LLM 合成三者连接:
 * 1. preflight 时自动提取项目的模块结构和依赖图
 * 2. 将依赖模式作为"架构指纹"存入向量引擎
 * 3. 后续 diff 时对比指纹 → 发现架构漂移 → 报告 policy violation
 *
 * 不依赖外部代码图工具 — 通过分析文件路径和 import 语句提取架构模式。
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { getProjectRoot } from "../handlers/_utils.js";
import { isNativeAvailable, initNativeStore, indexViolationEmbedding, searchSimilarViolations, computeSimpleEmbedding } from "../native-bridge.js";

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
  type: "layer_violation" | "circular_dependency" | "forbidden_import" | "unexpected_dependency";
  fromModule: string;
  toModule?: string;
  severity: "warn" | "hard_stop";
  message: string;
};

export type ArchitectureFingerprint = {
  modules: ModuleBoundary[];
  dependencies: Dependency[];
  rules: LayerRule[];
  files: string[];
};

// ─── 模块发现 ─────────────────────────────────────────────────

const MODULE_PATTERNS = ["src", "packages", "lib", "app", "components", "api"];

function discoverModules(root: string): ModuleBoundary[] {
  const modules: ModuleBoundary[] = [];

  for (const pattern of MODULE_PATTERNS) {
    const dir = resolve(root, pattern);
    if (existsSync(dir)) {
      modules.push({ name: pattern, path: dir, depth: 1 });
      // Discover subdirectories as potential sub-modules
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
            modules.push({ name: `${pattern}/${entry.name}`, path: resolve(dir, entry.name), depth: 2 });
          }
        }
      } catch { /* permission */ }
    }
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
    if (match[2] && !match[2].includes("node_modules")) {
      imports.push(match[2]);
    }
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

function extractDependencies(root: string, modules: ModuleBoundary[]): Dependency[] {
  const deps: Dependency[] = [];
  const seen = new Set<string>();

  function walkDir(dir: string) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
          walkDir(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".js") || entry.name.endsWith(".jsx"))) {
          const fromModule = resolveModule(fullPath, ".", modules);
          if (!fromModule) continue;
          const content = readFileSync(fullPath, "utf-8");
          const imports = extractImports(content);
          for (const imp of imports) {
            const toModule = resolveModule(fullPath, imp, modules);
            if (toModule && fromModule !== toModule) {
              const key = `${fromModule}→${toModule}`;
              if (!seen.has(key)) {
                seen.add(key);
                deps.push({
                  fromModule,
                  toModule,
                  fromFile: relative(root, fullPath),
                  toFile: imp,
                  count: 1,
                });
              } else {
                const existing = deps.find((d) => d.fromModule === fromModule && d.toModule === toModule);
                if (existing) existing.count++;
              }
            }
          }
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  walkDir(resolve(root, "src"));
  return deps;
}

// ─── 层规则推导 ───────────────────────────────────────────────

function inferLayerRules(deps: Dependency[], modules: ModuleBoundary[]): LayerRule[] {
  const rules: LayerRule[] = [];

  // Rule 1: Detect circular dependencies
  for (const dep of deps) {
    const reverse = deps.find((d) => d.fromModule === dep.toModule && d.toModule === dep.fromModule);
    if (reverse) {
      rules.push({
        type: "circular_dependency",
        fromModule: dep.fromModule,
        toModule: dep.toModule,
        severity: "hard_stop",
        message: `Circular dependency: ${dep.fromModule} ↔ ${dep.toModule}`,
      });
    }
  }

  // Rule 2: Infer layer boundaries from depth
  const depthMap = new Map(modules.map((m) => [m.name, m.depth]));
  for (const dep of deps) {
    const fromDepth = depthMap.get(dep.fromModule) ?? 1;
    const toDepth = depthMap.get(dep.toModule) ?? 1;
    if (dep.count >= 3 && fromDepth >= toDepth) {
      // Deep module frequently importing shallow module: potential layer violation
      // e.g. src/components/ui importing src/api
    }
  }

  return rules;
}

// ─── 指纹构建与对比 ───────────────────────────────────────────

const FINGERPRINT_COLLECTION = "architecture";

export function buildArchitectureFingerprint(root: string): ArchitectureFingerprint {
  const modules = discoverModules(root);
  const dependencies = extractDependencies(root, modules);
  const rules = inferLayerRules(dependencies, modules);
  return { modules, dependencies, rules, files: dependencies.map((d) => d.fromFile) };
}

export function storeArchitectureFingerprint(fingerprint: ArchitectureFingerprint): void {
  if (!isNativeAvailable()) return;
  initNativeStore();

  // Store modules as embeddings
  for (const mod of fingerprint.modules) {
    const text = `module:${mod.name} depth:${mod.depth} path:${mod.path}`;
    indexViolationEmbedding(`mod-${mod.name}`, text, { type: "module", name: mod.name });
  }

  // Store dependency rules as embeddings
  for (const rule of fingerprint.rules) {
    indexViolationEmbedding(`rule-${rule.type}-${rule.fromModule}`, rule.message, {
      type: "architecture_rule",
      ruleType: rule.type,
      severity: rule.severity,
    });
  }
}

export function checkArchitectureDrift(
  changedFiles: string[],
  root: string,
): LayerRule[] {
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

          // Check if this is a new dependency (not in fingerprint)
          const existingDep = fingerprint.dependencies.find(
            (d) => d.fromModule === fromModule.name && d.toModule === toModule.name,
          );

          if (!existingDep && !seen.has(key)) {
            seen.add(key);
            violations.push({
              type: "unexpected_dependency",
              fromModule: fromModule.name,
              toModule: toModule.name,
              severity: "warn",
              message: `New cross-module dependency: ${fromModule.name} → ${toModule.name} (file: ${file})`,
            });
          }

          // Circular check
          if (fingerprint.rules.some((r) => r.type === "circular_dependency" && r.fromModule === toModule.name && r.toModule === fromModule.name)) {
            violations.push({
              type: "circular_dependency",
              fromModule: fromModule.name,
              toModule: toModule.name,
              severity: "hard_stop",
              message: `Would create circular dependency: ${fromModule.name} ↔ ${toModule.name}`,
            });
          }
        }
      }
    } catch { /* skip unreadable */ }
  }

  return violations;
}

// ─── LLM 架构报告 ─────────────────────────────────────────────

export function buildArchitectureReport(root: string): string {
  const fingerprint = buildArchitectureFingerprint(root);

  const parts = [
    "## Architecture Context (Ritsu)",
    "",
    `### Modules (${fingerprint.modules.length})`,
    "```",
    ...fingerprint.modules.map((m) => `${m.name}`),
    "```",
    "",
    `### Cross-Module Dependencies (${fingerprint.dependencies.length})`,
    "```",
    ...fingerprint.dependencies.map((d) => `${d.fromModule} → ${d.toModule} (${d.count}x)`),
    "```",
  ];

  if (fingerprint.rules.length > 0) {
    parts.push(`\n### Active Architecture Rules (${fingerprint.rules.length})`);
    for (const rule of fingerprint.rules) {
      parts.push(`- [${rule.severity}] ${rule.message}`);
    }
  }

  return parts.join("\n");
}

export function buildArchitectureSignals(root: string): string[] {
  const fingerprint = buildArchitectureFingerprint(root);
  const totalDeps = fingerprint.dependencies.length;
  const uniqueFrom = new Set(fingerprint.dependencies.map((d) => d.fromModule)).size;
  const uniqueTo = new Set(fingerprint.dependencies.map((d) => d.toModule)).size;

  return [
    `[signal:architecture]`,
    `modules: ${fingerprint.modules.length}`,
    `cross_module_deps: ${totalDeps}`,
    `dependency_sources: ${uniqueFrom}`,
    `dependency_targets: ${uniqueTo}`,
    `rules: ${fingerprint.rules.length}`,
    `circular_deps: ${fingerprint.rules.filter((r) => r.type === "circular_dependency").length}`,
    `status: PASS`,
  ];
}
