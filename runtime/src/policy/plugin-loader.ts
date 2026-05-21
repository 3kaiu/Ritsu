/**
 * 策略检测器插件加载器
 *
 * 支持从 `rules/detectors/` 目录加载用户自定义检测器。
 * 每个插件文件应导出一个 `createDetector(): DetectorPlugin` 函数。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DetectorPlugin } from "./types.js";
import { RegexDetector } from "./detectors/regex.js";
import { CrossFileDetector } from "./detectors/cross-file.js";
import { ScopeDiffDetector } from "./detectors/scope-diff.js";
import { ContractCoverageDetector } from "./detectors/contract-coverage.js";
import { PreferenceLintDetector } from "./detectors/preference-lint.js";
import { AstGrepDetector } from "./detectors/ast-grep.js";
import { AstDetector } from "./detectors/ast.js";
import { CodeGraphDetector } from "./detectors/codegraph.js";
import { ArchitectureDetector } from "./detectors/architecture.js";
import { getProjectRoot } from "../handlers/_utils.js";

const BUILT_IN_DETECTORS: Record<string, DetectorPlugin> = {
  regex: new RegexDetector(),
  cross_file: new CrossFileDetector(),
  scope_diff: new ScopeDiffDetector(),
  contract_coverage: new ContractCoverageDetector(),
  preference_lint: new PreferenceLintDetector(),
  ast_grep: new AstGrepDetector(),
  ast: new AstDetector(),
  codegraph: new CodeGraphDetector(),
  architecture: new ArchitectureDetector(),
};

let _cachedPlugins: Record<string, DetectorPlugin> | null = null;

/**
 * 获取所有检测器（内置 + 用户自定义插件）。
 * 用户插件可覆盖同名的内置检测器。
 */
export function getAllDetectors(): Record<string, DetectorPlugin> {
  if (_cachedPlugins) return _cachedPlugins;

  const detectors = { ...BUILT_IN_DETECTORS };

  // 扫描用户自定义插件目录
  const pluginsDir = resolve(getProjectRoot(), "rules", "detectors");
  if (existsSync(pluginsDir)) {
    // Optional manifest.json for plugin metadata
    const manifestPath = resolve(pluginsDir, "manifest.json");
    let manifest: Record<string, unknown> | null = null;
    if (existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
      } catch {
        console.warn("[ritsu] Failed to parse plugin manifest.json");
      }
    }

    const files = readdirSync(pluginsDir).filter(
      (f) => f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".cjs") || f === "manifest.json",
    );

    const manifestPlugins = manifest?.plugins;
    const pluginRegistry = Array.isArray(manifestPlugins)
      ? manifestPlugins
      : files.filter((f) => f !== "manifest.json");

    for (const plugin of pluginRegistry) {
      try {
        const pluginPath = typeof plugin === "string"
          ? resolve(pluginsDir, plugin)
          : typeof plugin === "object" && plugin !== null && typeof (plugin as Record<string, unknown>).file === "string"
            ? resolve(pluginsDir, (plugin as Record<string, unknown>).file as string)
            : null;

        if (!pluginPath || !existsSync(pluginPath)) {
          if (typeof plugin === "object" && plugin !== null) {
            console.warn(`[ritsu] Plugin file not found: ${(plugin as Record<string, unknown>).file}`);
          }
          continue;
        }

        const mod = require(pluginPath) as {
          createDetector?: () => DetectorPlugin;
          default?: { createDetector?: () => DetectorPlugin };
        };
        const createFn = mod.createDetector ?? (mod.default as { createDetector?: () => DetectorPlugin } | null)?.createDetector;
        if (typeof createFn === "function") {
          const pluginInstance = createFn();

          // Validate minRuntime if manifest provides it
          if (typeof plugin === "object" && plugin !== null) {
            const p = plugin as Record<string, unknown>;
            if (typeof p.minRuntime === "string") {
              const currentVersion = "6.5.0";
              if (currentVersion.localeCompare(p.minRuntime as string) < 0) {
                console.warn(`[ritsu] Plugin '${p.id ?? p.file ?? "unknown"}' requires runtime ${p.minRuntime}, current is ${currentVersion} — loading anyway`);
              }
            }
          }

          detectors[pluginInstance.type] = pluginInstance;
        }
      } catch (e) {
        const pluginName = typeof plugin === "string" ? plugin : (plugin as Record<string, unknown>)?.file ?? "unknown";
        console.warn(`[ritsu] Failed to load detector plugin: ${pluginName}`, e);
      }
    }
  }

  _cachedPlugins = detectors;
  return detectors;
}

/** 清除插件缓存（热重载时使用） */
export function clearPluginCache(): void {
  _cachedPlugins = null;
}

/** 获取特定类型的检测器 */
export function getDetector(type: string): DetectorPlugin | undefined {
  return getAllDetectors()[type];
}
