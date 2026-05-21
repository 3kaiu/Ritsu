import { color } from "./shared.js";
import { syncPush, syncPull } from "../sync.js";

export async function runSync(action: string) {
  if (action === "push") {
    console.log(color("Pushing .ritsu harness to refs/ritsu/* ...", "dim"));
    const ok = syncPush();
    if (ok) console.log(color("✔ Sync push successful.", "green"));
    else console.error(color("✖ Sync push failed.", "red"));
  } else if (action === "pull") {
    console.log(color("Pulling .ritsu harness from refs/ritsu/* ...", "dim"));
    const ok = syncPull();
    if (ok) console.log(color("✔ Sync pull successful.", "green"));
    else console.error(color("✖ Sync pull failed.", "red"));
  } else {
    console.error(color(`Unknown sync action: ${action}`, "red"));
    process.exit(1);
  }
}
