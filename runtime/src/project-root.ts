import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function detectProjectRoot(start = process.cwd()): string {
  const envRoot = process.env.RITSU_PROJECT_ROOT;
  if (envRoot) return envRoot;

  let current = resolve(start);
  let nearestRitsuDir: string | null = null;

  for (;;) {
    if (existsSync(resolve(current, "AGENTS.md"))) {
      return current;
    }
    if (!nearestRitsuDir && existsSync(resolve(current, ".ritsu"))) {
      nearestRitsuDir = current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return nearestRitsuDir ?? resolve(start);
    }
    current = parent;
  }
}
