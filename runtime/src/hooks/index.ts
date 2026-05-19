import { autoArchivePlugin } from "./plugins/auto-archive.js";
import { autoSyncPlugin } from "./plugins/auto-sync.js";

export interface SpanContext {
  trace_id: string;
  span_id: string;
  skill: string;
  domain: string;
  status: "done" | "failed";
}

export type HookEvent = {
  type: "span_closed";
  payload: SpanContext;
};

export interface HookPlugin {
  name: string;
  onEvent: (event: HookEvent) => Promise<void> | void;
}

const PLUGINS: HookPlugin[] = [
  autoArchivePlugin,
  autoSyncPlugin,
];

export async function dispatchHook(event: HookEvent): Promise<void> {
  await Promise.allSettled(
    PLUGINS.map(async (plugin) => {
      try {
        await plugin.onEvent(event);
      } catch (err) {
        console.error(`[Hook Error] Plugin ${plugin.name} failed on ${event.type}:`, err);
      }
    })
  );
}
