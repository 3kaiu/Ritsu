import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type TsPathMapping = {
  prefix: string;
  suffix: string;
  targets: string[];
};

type TsImportResolver = {
  baseUrlAbs: string;
  mappings: TsPathMapping[];
};

export function readTsImportResolver(root: string): TsImportResolver | null {
  const tsconfigPath = resolve(root, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return null;

  try {
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8")) as any;
    const compilerOptions = tsconfig?.compilerOptions ?? {};
    const baseUrlRel = String(compilerOptions.baseUrl ?? ".");
    const baseUrlAbs = resolve(root, baseUrlRel);
    const paths = compilerOptions.paths ?? {};

    const mappings: TsPathMapping[] = [];
    for (const [pattern, arr] of Object.entries(paths)) {
      if (typeof pattern !== "string") continue;
      if (!Array.isArray(arr)) continue;

      const starIdx = pattern.indexOf("*");
      const prefix = starIdx >= 0 ? pattern.slice(0, starIdx) : pattern;
      const suffix = starIdx >= 0 ? pattern.slice(starIdx + 1) : "";
      const targets = (arr as any[]).filter((x) => typeof x === "string") as string[];
      if (targets.length === 0) continue;

      mappings.push({ prefix, suffix, targets });
    }

    return { baseUrlAbs, mappings };
  } catch {
    return null;
  }
}

export function resolveWithCandidates(base: string): string | null {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    resolve(base, "index.ts"),
    resolve(base, "index.tsx"),
    resolve(base, "index.js"),
    resolve(base, "index.jsx"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export function resolveImport(
  fromDirAbs: string,
  spec: string,
  resolver: TsImportResolver | null,
): string | null {
  if (spec.startsWith(".")) {
    const base = resolve(fromDirAbs, spec);
    return resolveWithCandidates(base);
  }

  if (resolver && resolver.mappings.length > 0) {
    for (const m of resolver.mappings) {
      if (!spec.startsWith(m.prefix) || !spec.endsWith(m.suffix)) continue;
      const captured = spec.slice(m.prefix.length, spec.length - m.suffix.length);
      for (const target of m.targets) {
        const resolvedTarget = target.includes("*") ? target.replace("*", captured) : target;
        const base = resolve(resolver.baseUrlAbs, resolvedTarget);
        const hit = resolveWithCandidates(base);
        if (hit) return hit;
      }
    }
  }

  return null;
}
