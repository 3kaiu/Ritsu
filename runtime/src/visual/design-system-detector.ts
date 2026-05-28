/**
 * fe-sight — Design System Detector
 *
 * Detects which design system / component library the project uses.
 * This allows fe_sight_check to skip pixel-level checks on
 * framework-provided components (where the library guarantees fidelity).
 *
 * Example:
 *   shadcn/ui Button → skip padding/radius/font checks
 *   antd Space → skip gap checks
 *   Not detected → full check
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DesignSystemInfo {
  name: "shadcn-ui" | "antd" | "material-ui" | "chakra-ui" | "radix-ui" | "custom";
  detected: boolean;
  /**
   * Component names that should be skipped for style checks.
   * These are guaranteed by the design system.
   */
  skipStyleCheckFor: string[];
  /**
   * CSS properties that are guaranteed by the design system.
   */
  guaranteedProps: string[];
}

const DETECTORS: Array<{
  name: DesignSystemInfo["name"];
  check: (pkg: Record<string, string>, files: string[]) => boolean;
  skipComponents: string[];
  guaranteedProps: string[];
}> = [
  {
    name: "shadcn-ui",
    check: (_pkg, files) =>
      files.some((f) => f.includes("components/ui")) ||
      existsSync(resolve(process.cwd(), "components.json")),
    skipComponents: [
      "button", "input", "card", "dialog", "dropdown-menu",
      "select", "tabs", "textarea", "badge", "avatar",
    ],
    guaranteedProps: ["font-size", "font-weight", "padding", "border-radius"],
  },
  {
    name: "antd",
    check: (pkg) => !!pkg.antd,
    skipComponents: [
      "button", "input", "space", "select", "table", "form",
      "card", "modal", "tag", "badge",
    ],
    guaranteedProps: ["font-size", "padding", "color", "border-radius", "gap"],
  },
  {
    name: "material-ui",
    check: (pkg) => !!pkg["@mui/material"] || !!pkg["@mui/core"],
    skipComponents: [
      "button", "textfield", "select", "dialog", "card",
      "typography", "appbar", "drawer",
    ],
    guaranteedProps: ["font-size", "font-family", "line-height", "letter-spacing"],
  },
  {
    name: "radix-ui",
    check: (pkg) => Object.keys(pkg).some((k) => k.startsWith("@radix-ui/")),
    skipComponents: [
      "dialog", "dropdown-menu", "popover", "tooltip",
      "select", "tabs", "toggle",
    ],
    guaranteedProps: ["padding", "border-radius", "font-size"],
  },
  {
    name: "chakra-ui",
    check: (pkg) => !!pkg["@chakra-ui/react"],
    skipComponents: [
      "button", "input", "select", "modal", "card",
    ],
    guaranteedProps: ["padding", "font-size", "line-height", "color"],
  },
];

export function detectDesignSystem(projectRoot: string): DesignSystemInfo {
  const pkgPath = resolve(projectRoot, "package.json");
  if (!existsSync(pkgPath)) {
    return { name: "custom", detected: false, skipStyleCheckFor: [], guaranteedProps: [] };
  }

  let pkg: Record<string, string> = {};
  try {
    const raw = JSON.parse(readFileSync(pkgPath, "utf-8"));
    pkg = { ...raw.dependencies, ...raw.devDependencies };
  } catch {
    return { name: "custom", detected: false, skipStyleCheckFor: [], guaranteedProps: [] };
  }

  // Collect UI-related file paths for file-based detection
  const files: string[] = [];
  const uiDir = resolve(projectRoot, "src", "components");
  if (existsSync(uiDir)) {
    try {
      const { readdirSync } = require("node:fs") as typeof import("node:fs");
      const walk = (dir: string): string[] => {
        const entries = readdirSync(dir, { withFileTypes: true });
        return entries.flatMap((e) => {
          const full = resolve(dir, e.name);
          return e.isDirectory() ? walk(full) : [full];
        });
      };
      files.push(...walk(uiDir));
    } catch {
      // ignore fs errors
    }
  }

  for (const detector of DETECTORS) {
    if (detector.check(pkg, files)) {
      return {
        name: detector.name,
        detected: true,
        skipStyleCheckFor: detector.skipComponents,
        guaranteedProps: detector.guaranteedProps,
      };
    }
  }

  return { name: "custom", detected: false, skipStyleCheckFor: [], guaranteedProps: [] };
}
