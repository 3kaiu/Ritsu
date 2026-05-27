/**
 * Tests for DataStore abstraction
 *
 * v8.5.0
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync, mkdtempSync } from "node:fs";
import { resolve } from "node:path";

import { DataStore, type Storable } from "../data-store.js";

interface TestData extends Storable {
  items: string[];
  count: number;
}

describe("DataStore", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ritsu-test-ds-"));
    mkdirSync(join(tmpDir, ".ritsu"), { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeStore(filename = "test.json"): DataStore<TestData> {
    return new DataStore<TestData>(
      resolve(tmpDir, ".ritsu", filename),
      () => ({ version: 1, updated_at: "", items: [], count: 0 }),
    );
  }

  it("should return defaults when file doesn't exist", () => {
    const store = makeStore("nonexistent.json");
    const data = store.read();
    expect(data.version).toBe(1);
    expect(data.items).toEqual([]);
    expect(data.count).toBe(0);
  });

  it("should write and read data", () => {
    const store = makeStore("write-test.json");
    store.write({ version: 1, updated_at: "", items: ["a", "b"], count: 2 });

    const data = store.read();
    expect(data.items).toEqual(["a", "b"]);
    expect(data.count).toBe(2);
  });

  it("should update atomically", () => {
    const store = makeStore("update-test.json");
    store.write({ version: 1, updated_at: "", items: [], count: 0 });

    store.update((data) => {
      data.items.push("x");
      data.count = 1;
    });

    const data = store.read();
    expect(data.items).toEqual(["x"]);
    expect(data.count).toBe(1);
  });

  it("should update updated_at on write", () => {
    const store = makeStore("timestamp-test.json");
    store.write({ version: 1, updated_at: "", items: [], count: 0 });

    const data = store.read();
    expect(data.updated_at).toBeTruthy();
    expect(data.updated_at.length).toBeGreaterThan(10);
  });

  it("should update updated_at on update()", () => {
    const store = makeStore("timestamp-update-test.json");
    store.write({ version: 1, updated_at: "old", items: [], count: 0 });

    store.update((data) => { data.count = 5; });

    const data = store.read();
    expect(data.updated_at).not.toBe("old");
    expect(data.count).toBe(5);
  });

  it("should create directory on write", () => {
    const nestedDir = mkdtempSync(join(tmpdir(), "ritsu-test-ds-nested-"));
    const deepPath = resolve(nestedDir, "a", "b", "c", "deep.json");
    const store = new DataStore<TestData>(deepPath, () => ({
      version: 1, updated_at: "", items: [], count: 0,
    }));

    store.write({ version: 1, updated_at: "", items: ["deep"], count: 1 });
    expect(existsSync(deepPath)).toBe(true);
    expect(store.read().items).toEqual(["deep"]);

    rmSync(nestedDir, { recursive: true, force: true });
  });

  it("should handle corrupt files gracefully", () => {
    const store = makeStore("corrupt.json");
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(
      resolve(tmpDir, ".ritsu", "corrupt.json"),
      "not valid json{{{",
      "utf-8",
    );

    const data = store.read();
    expect(data.version).toBe(1); // back to defaults
    expect(data.items).toEqual([]);
  });

  it("should clear the store file", () => {
    const store = makeStore("clear-test.json");
    store.write({ version: 1, updated_at: "", items: ["a"], count: 1 });
    expect(store.exists()).toBe(true);

    store.clear();
    expect(store.exists()).toBe(false);

    const data = store.read();
    expect(data.version).toBe(1); // back to defaults after clear
  });

  it("should handle concurrent updates", () => {
    const store = makeStore("concurrent-test.json");
    store.write({ version: 1, updated_at: "", items: [], count: 0 });

    // Multiple sequential updates
    store.update((data) => { data.items.push("1"); });
    store.update((data) => { data.items.push("2"); });
    store.update((data) => { data.items.push("3"); });

    const data = store.read();
    expect(data.items).toEqual(["1", "2", "3"]);
    expect(data.count).toBe(0);
  });

  it("should write files atomically", () => {
    const storePath = resolve(tmpDir, ".ritsu", "atomic-test.json");
    const store = new DataStore<TestData>(storePath, () => ({
      version: 1, updated_at: "", items: [], count: 0,
    }));

    store.write({ version: 1, updated_at: "", items: ["atomic"], count: 1 });

    // Check there are no .tmp files left
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const files = readdirSync(resolve(tmpDir, ".ritsu"));
    const tmpFiles = files.filter((f: string) => f.startsWith(".tmp-"));
    expect(tmpFiles.length).toBe(0);

    // File should be valid JSON
    const content = readFileSync(storePath, "utf-8");
    expect(() => JSON.parse(content)).not.toThrow();
  });
});
