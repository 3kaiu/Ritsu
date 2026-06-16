import { resolve } from "node:path";
import { platform, arch, homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

/**
 * Resolves the path to the ritsud binary following a multi-tier resolution strategy:
 * 1. node_modules/@ritsu/ritsud-[os]-[arch] optional dependencies
 * 2. Local Cargo release/debug build targets
 * 3. User home cache (~/.ritsu/bin/ritsud-[os]-[arch]), downloading on the fly if needed (non-blocking)
 * 4. Falls back to null (caller downgrades to the pure JS linter engine)
 */
export function getRitsudBinaryPath(projectRoot: string): string | null {
  const osType = platform();
  const cpuArch = arch();
  
  let platformKey = "";
  let binaryName = "ritsud";
  
  if (osType === "darwin" && cpuArch === "x64") platformKey = "darwin-x64";
  else if (osType === "darwin" && cpuArch === "arm64") platformKey = "darwin-arm64";
  else if (osType === "linux" && cpuArch === "x64") platformKey = "linux-x64";
  else if (osType === "win32" && (cpuArch === "x64" || cpuArch === "ia32")) {
    platformKey = "win32-x64";
    binaryName = "ritsud.exe";
  }

  if (!platformKey) {
    return null; // Unsupported platform
  }

  const pkgName = `@ritsu/ritsud-${platformKey}`;

  // Tier 1: node_modules optionalDependencies check
  const nodeModulesPaths = [
    resolve(projectRoot, "node_modules", pkgName, "bin", binaryName),
    resolve(projectRoot, "..", "node_modules", pkgName, "bin", binaryName)
  ];
  for (const p of nodeModulesPaths) {
    if (existsSync(p)) return p;
  }

  // Tier 2: Local Cargo target build path
  const localPaths = [
    resolve(projectRoot, "ritsud", "target", "release", binaryName),
    resolve(projectRoot, "ritsud", "target", "debug", binaryName),
    resolve(projectRoot, "..", "ritsud", "target", "release", binaryName)
  ];
  for (const p of localPaths) {
    if (existsSync(p)) return p;
  }

  // Tier 3: User Cache & In-place Download fallback
  const cacheDir = resolve(homedir(), ".ritsu", "bin");
  const cachedBinaryPath = resolve(cacheDir, `${binaryName}-${platformKey}`);
  
  if (existsSync(cachedBinaryPath)) {
    return cachedBinaryPath;
  }

  // Attempt silent download with strict timeout (CI/intranet non-blocking)
  try {
    mkdirSync(cacheDir, { recursive: true });
    
    const downloadUrl = `https://github.com/3kaiu/Ritsu/releases/download/v11.0.0/ritsud-${platformKey}`;
    console.log(`📡 Native sidecar not found. Attempting to download ritsud for ${platformKey}...`);
    
    // Download using curl with a 2-second connection timeout
    const curlRes = spawnSync("curl", [
      "-f",
      "-L",
      "-s",
      "--connect-timeout", "2",
      "--max-time", "5",
      "-o", cachedBinaryPath,
      downloadUrl
    ]);
    
    if (curlRes.status === 0 && existsSync(cachedBinaryPath)) {
      if (osType !== "win32") {
        spawnSync("chmod", ["+x", cachedBinaryPath]);
      }
      console.log(`✅ Successfully downloaded and cached ritsud sidecar.`);
      return cachedBinaryPath;
    }
  } catch (err) {
    // Fail silently to prevent blocking in isolated CI/intranets
    console.warn(`⚠️ Warning: Failed to download native ritsud: ${err}`);
  }

  // Tier 4: Fallback to JS engine
  return null;
}
