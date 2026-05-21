import { detectProjectRoot } from "../project-root.js";
import { color } from "./shared.js";
import { bootstrapEcosystem } from "../ecosystem-bootstrap.js";

export function runBootstrap(args: string[] = []): void {
  const root = detectProjectRoot();
  console.log(color("Ritsu Bootstrap — Ecosystem", "cyan"));
  let host: import("../ecosystem-bootstrap.js").HostProfile | undefined;
  let includeCursorHooks = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--host") {
      const h = args[++i];
      if (h === "claude-code" || h === "cursor" || h === "all") host = h;
    }
    if (args[i] === "--include-cursor-hooks") includeCursorHooks = true;
  }
  const result = bootstrapEcosystem(root, { host, include_cursor_hooks: includeCursorHooks });
  console.log(color(`Project: ${result.project_root}`, "dim"));
  console.log(color(`Host profile: ${result.host_profile}`, "dim"));
  if (result.files_written.length) console.log(color("Written:", "green"), result.files_written.join(", "));
  if (result.files_merged.length) console.log(color("Merged:", "yellow"), result.files_merged.join(", "));
  for (const note of result.notes) console.log(color(`  • ${note}`, "dim"));
}
