import { describe, it, expect, vi, beforeEach } from "vitest";

describe("hooks system", () => {
  // ─── dispatchHook ─────────────────────────────────────────

  describe("dispatchHook", () => {
    it("dispatches to all plugins", async () => {
      const { dispatchHook } = await import("../src/hooks/index.js");
      // Should not throw for any event type
      await expect(
        dispatchHook({
          type: "span_closed",
          payload: { trace_id: "t1", span_id: "s1", skill: "dev", domain: "fullstack", status: "done" },
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ─── auto-archive ─────────────────────────────────────────

  describe("auto-archive plugin", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("skips when event type is not span_closed", async () => {
      const mod = await import("../src/hooks/plugins/auto-archive.js");
      const plugin = mod.autoArchivePlugin;
      // Should not throw on unknown event type (early return)
      await expect(
        plugin.onEvent({ type: "unknown" as never, payload: { trace_id: "", span_id: "", skill: "", domain: "", status: "done" } }),
      ).resolves.toBeUndefined();
    });

    it("skips when skill is not review", async () => {
      const mod = await import("../src/hooks/plugins/auto-archive.js");
      const plugin = mod.autoArchivePlugin;
      await expect(
        plugin.onEvent({
          type: "span_closed",
          payload: { trace_id: "t1", span_id: "s1", skill: "dev", domain: "fullstack", status: "done" },
        }),
      ).resolves.toBeUndefined();
    });

    it("skips when status is not done", async () => {
      const mod = await import("../src/hooks/plugins/auto-archive.js");
      const plugin = mod.autoArchivePlugin;
      await expect(
        plugin.onEvent({
          type: "span_closed",
          payload: { trace_id: "t1", span_id: "s1", skill: "review", domain: "fullstack", status: "failed" },
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ─── auto-sync ────────────────────────────────────────────

  describe("auto-sync plugin", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("skips when event type is not span_closed", async () => {
      const mod = await import("../src/hooks/plugins/auto-sync.js");
      const plugin = mod.autoSyncPlugin;
      await expect(
        plugin.onEvent({ type: "unknown" as never, payload: { trace_id: "", span_id: "", skill: "", domain: "", status: "done" } }),
      ).resolves.toBeUndefined();
    });

    it("handles span_closed without error", async () => {
      const mod = await import("../src/hooks/plugins/auto-sync.js");
      const plugin = mod.autoSyncPlugin;
      await expect(
        plugin.onEvent({
          type: "span_closed",
          payload: { trace_id: "t1", span_id: "s1", skill: "dev", domain: "fullstack", status: "done" },
        }),
      ).resolves.toBeUndefined();
    });
  });
});
