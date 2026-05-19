import type { HookPlugin, HookEvent } from "../index.js";
import { syncPush } from "../../sync.js";

export const autoSyncPlugin: HookPlugin = {
  name: "auto-sync",
  onEvent: async (event: HookEvent) => {
    if (event.type !== "span_closed") return;
    
    // We can auto-sync on any span close, or just root span.
    // For simplicity, auto-sync when any span is done/failed, ensuring remote is updated frequently.
    try {
      // Run synchronously but ignore failure
      syncPush();
    } catch (err) {
      console.error(`[Auto-Sync] Failed to sync context:`, err);
    }
  },
};
