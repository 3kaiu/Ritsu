import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const mockCheckLock = vi.hoisted(() => vi.fn());
const mockLock = vi.hoisted(() => vi.fn());

vi.mock("proper-lockfile", () => ({
  check: mockCheckLock,
  lock: mockLock,
}));

import { readJsonFile, updateLockedJsonFile } from "../src/locked-json.js";

describe("locked-json", () => {
  let testRoot: string;
  let release: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-locked-json-"));
    release = vi.fn().mockResolvedValue(undefined);
    mockCheckLock.mockReset();
    mockLock.mockReset();
    mockCheckLock.mockResolvedValue(true);
    mockLock.mockResolvedValue(release);
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("returns a cloned fallback when the file is missing", () => {
    const fallback = { items: ["seed"] };

    const data = readJsonFile(join(testRoot, "missing.json"), fallback);
    data.items.push("mutated");

    expect(data).toEqual({ items: ["seed", "mutated"] });
    expect(fallback).toEqual({ items: ["seed"] });
  });

  it("returns the fallback for empty or malformed json content", () => {
    const emptyPath = join(testRoot, "empty.json");
    const malformedPath = join(testRoot, "malformed.json");
    writeFileSync(emptyPath, "   \n", "utf-8");
    writeFileSync(malformedPath, "{bad json", "utf-8");

    expect(readJsonFile(emptyPath, { ok: true })).toEqual({ ok: true });
    expect(readJsonFile(malformedPath, { ok: false })).toEqual({ ok: false });
  });

  it("parses valid json content", () => {
    const path = join(testRoot, "valid.json");
    writeFileSync(path, JSON.stringify({ count: 2 }), "utf-8");

    expect(readJsonFile(path, { count: 0 })).toEqual({ count: 2 });
  });

  it("creates missing directories, writes updated json, and releases the lock", async () => {
    const path = join(testRoot, ".ritsu", "state", "prefs.json");

    const result = await updateLockedJsonFile(path, { count: 0 }, async (current) => {
      expect(current).toEqual({ count: 0 });
      return {
        data: { count: current.count + 1 },
        result: "updated",
      };
    });

    expect(result).toBe("updated");
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ count: 1 });
    expect(mockLock).toHaveBeenCalledWith(path, {
      retries: {
        retries: 20,
        factor: 1,
        minTimeout: 25,
        maxTimeout: 25,
      },
    });
    expect(
      readdirSync(dirname(path)).filter(
        (name) => name.startsWith(".tmp-") && name.endsWith(".json"),
      ),
    ).toEqual([]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("removes stale lock files before updating persisted data", async () => {
    const path = join(testRoot, "leases.json");
    writeFileSync(path, JSON.stringify({ count: 1 }), "utf-8");
    writeFileSync(`${path}.lock`, "stale", "utf-8");
    mockCheckLock.mockResolvedValue(false);

    const result = await updateLockedJsonFile(path, { count: 0 }, (current) => ({
      data: { count: current.count + 1 },
      result: current.count,
    }));

    expect(result).toBe(1);
    expect(mockCheckLock).toHaveBeenCalledWith(path, {
      lockfilePath: `${path}.lock`,
    });
    expect(existsSync(`${path}.lock`)).toBe(false);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ count: 2 });
  });

  it("recovers from malformed json and unreadable lock markers", async () => {
    const path = join(testRoot, "broken.json");
    writeFileSync(path, "{not json", "utf-8");
    writeFileSync(`${path}.lock`, "broken lock", "utf-8");
    mockCheckLock.mockRejectedValue(new Error("lock metadata unreadable"));

    const result = await updateLockedJsonFile(path, { count: 5 }, (current) => ({
      data: { count: current.count + 1 },
      result: current.count,
    }));

    expect(result).toBe(5);
    expect(existsSync(`${path}.lock`)).toBe(false);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ count: 6 });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("keeps active lock files in place until the lock is released", async () => {
    const path = join(testRoot, "active.json");
    const lockPath = `${path}.lock`;
    writeFileSync(path, JSON.stringify({ count: 3 }), "utf-8");
    writeFileSync(lockPath, "active", "utf-8");
    mockCheckLock.mockResolvedValue(true);
    release = vi.fn().mockImplementation(async () => {
      rmSync(lockPath, { force: true });
    });
    mockLock.mockImplementation(async (lockedPath: string) => {
      expect(lockedPath).toBe(path);
      expect(existsSync(lockPath)).toBe(true);
      return release;
    });

    const result = await updateLockedJsonFile(path, { count: 0 }, (current) => ({
      data: { count: current.count + 1 },
      result: current.count,
    }));

    expect(result).toBe(3);
    expect(existsSync(lockPath)).toBe(false);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ count: 4 });
    expect(release).toHaveBeenCalledTimes(1);
  });
});
