/**
 * 策略检测器插件加载器
 *
 * 支持从 `rules/detectors/` 目录加载用户自定义检测器。
 * 每个插件文件应导出一个 `createDetector(): DetectorPlugin` 函数。
 */

import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { DetectorPlugin } from "./types.js";
import { RegexDetector } from "./detectors/regex.js";
import { CrossFileDetector } from "./detectors/cross-file.js";
import { ScopeDiffDetector } from "./detectors/scope-diff.js";
import { ContractCoverageDetector } from "./detectors/contract-coverage.js";
import { PreferenceLintDetector } from "./detectors/preference-lint.js";
import { AstGrepDetector } from "./detectors/ast-grep.js";
import { AstDetector } from "./detectors/ast.js";
import { getProjectRoot } from "../handlers/_utils.js";

const BUILT_IN_DETECTORS: Record<string, DetectorPlugin> = {
  regex: new RegexDetector(),
  cross_file: new CrossFileDetector(),
  scope_diff: new ScopeDiffDetector(),
  contract_coverage: new ContractCoverageDetector(),
  preference_lint: new PreferenceLintDetector(),
  ast_grep: new AstGrepDetector(),
  ast: new AstDetector(),
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
    const files = readdirSync(pluginsDir).filter(
      (f) => f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".cjs"),
    );

    for (const file of files) {
      try {
        const pluginPath = resolve(pluginsDir, file);
        // Dynamic import of user plugin
        const mod = require(pluginPath) as {
          createDetector?: () => DetectorPlugin;
          default?: { createDetector?: () => DetectorPlugin };
        };
        const createFn = mod.createDetector ?? (mod.default as { createDetector?: () => DetectorPlugin } | null)?.createDetector;
        if (typeof createFn === "function") {
          const plugin = createFn();
          detectors[plugin.type] = plugin;
        }
      } catch (e) {
        console.warn(`[ritsu] Failed to load detector plugin: ${file}`, e);
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
