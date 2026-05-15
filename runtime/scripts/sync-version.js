#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const versionCheckPath = resolve(__dirname, "../version-check.js");

const result = spawnSync("node", [versionCheckPath, "--write"], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
