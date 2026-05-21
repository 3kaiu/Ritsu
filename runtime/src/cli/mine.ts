import { color } from "./shared.js";
import { minePreferences, promotePreference, autoApplyMinedRules } from "../miner.js";
import { reconcilePreferences } from "../policy/index.js";

export async function runMine(args: string[]) {
  let days = 7;
  let report = false;
  let promoteId: string | null = null;
  let reconcile = false;
  let auto = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days") days = parseInt(args[++i] ?? "7", 10);
    else if (args[i] === "--report") report = true;
    else if (args[i] === "--promote") promoteId = args[++i] ?? null;
    else if (args[i] === "--reconcile") reconcile = true;
    else if (args[i] === "--auto") auto = true;
  }

  if (auto) {
    console.log(color(`Ritsu Preference Miner — Auto-mining & reconciling preferences from past ${days} days...`, "cyan"));
    const result = autoApplyMinedRules(days);
    console.log(color(`✔ Self-evolution complete. Learned and applied ${result.addedCount} new preference rules.`, "green"));
    if (result.rules.length > 0) {
      console.log(color("\nMined rules summary:", "dim"));
      for (const rule of result.rules) console.log(color(`  - [${rule.id}] scope: ${rule.scope} | pattern: ${rule.match_regex}`, "yellow"));
    }
    return;
  }

  if (reconcile) {
    console.log(color("Ritsu Preference Miner — Reconciling preferences with AST-Grep rules...", "cyan"));
    const ok = reconcilePreferences();
    if (ok) console.log(color("✔ Preference AST-Grep rules reconciled successfully.", "green"));
    else { console.error(color("✖ Preference reconciliation failed.", "red")); process.exit(1); }
    return;
  }

  if (promoteId) {
    console.log(color(`Ritsu Preference Miner — Promoting ${promoteId}...`, "cyan"));
    const ok = promotePreference(promoteId);
    if (ok) console.log(color(`✔ Preference ${promoteId} promoted successfully to .ritsu/preferences.yaml`, "green"));
    else { console.error(color("✖ Failed to find proposal for " + promoteId + " in recent mining sheets.", "red")); process.exit(1); }
    return;
  }

  if (report || args.length === 0) {
    console.log(color(`Ritsu Preference Miner — Scanning past ${days} days...`, "cyan"));
    const outPath = minePreferences(days);
    if (!outPath) { console.log(color("No human corrections or violations found.", "green")); return; }
    console.log(color("✔ Mining Sheet generated successfully!", "green"));
    console.log(color("Please ask your LLM to review the sheet and extract rules:", "dim"));
    console.log(color(`  > ${outPath}`, "yellow"));
    return;
  }

  // Fallback: show usage when no matching flag is provided
  console.log(color("Run 'ritsu --help' for available commands.", "dim"));
}
