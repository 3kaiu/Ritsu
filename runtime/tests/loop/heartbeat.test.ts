import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  matchCron,
  loadHeartbeats,
  saveHeartbeats,
  registerTaskRunner,
  startHeartbeatScheduler,
  stopHeartbeatScheduler,
  type HeartbeatConfig,
} from "../../src/loop/heartbeat.js";
import { existsSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("heartbeat scheduler", () => {
  let testRoot: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-heartbeat-"));
    originalEnv = { ...process.env };
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    stopHeartbeatScheduler();
    process.env = originalEnv;
    vi.restoreAllMocks();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe("matchCron", () => {
    it("matches wildcards", () => {
      const date = new Date("2026-06-15T09:00:00Z"); // Monday (day of week: 1)
      expect(matchCron("* * * * *", date)).toBe(true);
    });

    it("matches exact minute and hour", () => {
      const date = new Date("2026-06-15T09:30:00Z"); // 30 mins, 9 hours (using local time for Date elements in matchCron)
      // Since matchCron uses local time, let's create Date object dynamically
      const d = new Date();
      d.setMinutes(30);
      d.setHours(9);
      expect(matchCron("30 9 * * *", d)).toBe(true);
      expect(matchCron("15 9 * * *", d)).toBe(false);
    });

    it("matches steps", () => {
      const d = new Date();
      d.setMinutes(15);
      expect(matchCron("*/5 * * * *", d)).toBe(true);
      expect(matchCron("*/10 * * * *", d)).toBe(false);
    });

    it("matches ranges", () => {
      const d = new Date();
      d.setHours(3);
      expect(matchCron("* 1-5 * * *", d)).toBe(true);
      expect(matchCron("* 4-8 * * *", d)).toBe(false);
    });

    it("matches lists", () => {
      const d = new Date();
      d.setMinutes(7);
      expect(matchCron("5,7,9 * * * *", d)).toBe(true);
      expect(matchCron("5,8,9 * * * *", d)).toBe(false);
    });
  });

  describe("persistence", () => {
    it("can save and load heartbeat configurations", () => {
      const configs: HeartbeatConfig[] = [
        {
          id: "test-loop",
          cron: "*/5 * * * *",
          taskType: "test-augment",
          taskParams: { targetFile: "file.ts" },
          enabled: true,
          consecutiveFailures: 0,
          maxConsecutiveFailures: 3,
        },
      ];

      saveHeartbeats(testRoot, configs);
      const loaded = loadHeartbeats(testRoot);
      expect(loaded).toEqual(configs);
    });
  });

  describe("scheduler functionality", () => {
    it("triggers job when cron matches and handles failures", async () => {
      vi.useFakeTimers();

      let runCount = 0;
      let passResult = false;
      const mockRunner = vi.fn().mockImplementation(async () => {
        runCount++;
        return { passed: passResult, reason: "Mock verdict" };
      });
      registerTaskRunner("mock-task", mockRunner);

      const d = new Date();
      d.setMinutes(0); // matches cron "0 * * * *"
      vi.setSystemTime(d);

      const configs: HeartbeatConfig[] = [
        {
          id: "mock-job",
          cron: "0 * * * *",
          taskType: "mock-task",
          taskParams: {},
          enabled: true,
          consecutiveFailures: 0,
          maxConsecutiveFailures: 2,
        },
      ];
      saveHeartbeats(testRoot, configs);

      startHeartbeatScheduler(1000); // 1s ticks

      // advance time by 1 tick
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockRunner).toHaveBeenCalledTimes(1);
      expect(runCount).toBe(1);

      // Wait for the background runner promise to resolve and update config
      await vi.advanceTimersByTimeAsync(50);

      let currentConfigs = loadHeartbeats(testRoot);
      expect(currentConfigs[0].consecutiveFailures).toBe(1);
      expect(currentConfigs[0].enabled).toBe(true); // not disabled yet (failures: 1 < max: 2)

      // advance to next hour
      const nextHour = new Date(d.getTime() + 3600 * 1000);
      nextHour.setMinutes(0);
      vi.setSystemTime(nextHour);

      // advance tick
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockRunner).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(50);
      currentConfigs = loadHeartbeats(testRoot);
      expect(currentConfigs[0].consecutiveFailures).toBe(2);
      expect(currentConfigs[0].enabled).toBe(false); // disabled! consecutiveFailures (2) >= max (2)

      vi.useRealTimers();
    });
  });
});
