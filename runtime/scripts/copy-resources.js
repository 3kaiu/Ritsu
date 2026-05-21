#!/usr/bin/env node

/**
 * Ritsu Compilation Resource Copier
 * 
 * This script runs post-compilation (TSC) to copy static assets
 * (_shared, rules) into the compiled dist directory.
 * This makes the published npm package ('ritsu-mcp-server') fully
 * self-contained, enabling zero-clone 'npx -y ritsu-mcp-server' execution.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runtimeDir = resolve(__dirname, "..");
const repoRoot = resolve(runtimeDir, "..");
const distDir = resolve(runtimeDir, "dist");

function copyFolderSync(from, to) {
  if (!existsSync(from)) return;
  if (!existsSync(to)) {
    mkdirSync(to, { recursive: true });
  }

  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const srcPath = resolve(from, entry.name);
    const destPath = resolve(to, entry.name);

    if (entry.isDirectory()) {
      copyFolderSync(srcPath, destPath);
    } else {
      try {
        writeFileSync(destPath, readFileSync(srcPath));
      } catch (err) {
        console.error(`Failed to copy file from ${srcPath} to ${destPath}:`, err);
      }
    }
  }
}

// Ensure dist directory exists
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

// 1. Copy _shared
console.log("[copy-resources] Bundling _shared assets to dist/_shared...");
copyFolderSync(resolve(repoRoot, "_shared"), resolve(distDir, "_shared"));

// 2. Copy rules
console.log("[copy-resources] Bundling rules templates to dist/rules...");
copyFolderSync(resolve(repoRoot, "rules"), resolve(distDir, "rules"));

console.log("[copy-resources] All static resources bundled successfully!");
