import type { HookPlugin, HookEvent } from "../index.js";
import { getProjectRoot } from "../../handlers/_utils.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

export const autoArchivePlugin: HookPlugin = {
  name: "auto-archive",
  onEvent: async (event: HookEvent) => {
    if (event.type !== "span_closed") return;
    const { skill, status } = event.payload;

    // Only archive automatically when a review is successfully done
    if (skill !== "review" || status !== "done") return;

    const root = getProjectRoot();
    const openspecDir = resolve(root, "openspec");

    // Check if the project is using OpenSpec
    if (!existsSync(openspecDir)) {
      console.log(`[Auto-Archive] 'openspec/' directory not found. Skipping OpenSpec auto-archive.`);
      return;
    }

    try {
      console.log(`[Auto-Archive] Detected OpenSpec project. Triggering 'openspec archive'...`);
      // We run npx openspec archive -y to automatically archive without prompts
      execSync("npx --yes @fission-ai/openspec@latest archive -y", { 
        cwd: root, 
        stdio: "inherit" // or "ignore" if we want it completely silent
      });
      console.log(`[Auto-Archive] OpenSpec archive completed successfully.`);
    } catch (err) {
      console.error(`[Auto-Archive] Failed to execute openspec archive:`, err);
    }
  },
};
