import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

import { readJsonFile, updateLockedJsonFile } from "../src/locked-json.js";

describe("locked-json", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-locked-json-"));
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
    const filePath = join(testRoot, "bad.json");
    writeFileSync(filePath, "not-json", "utf-8");
    const data = readJsonFile(filePath, { fallback: true });
    expect(data).toEqual({ fallback: true });
  });

  it("parses valid json content", () => {
    const filePath = join(testRoot, "data.json");
    writeFileSync(filePath, JSON.stringify({ hello: "world" }), "utf-8");
    expect(readJsonFile(filePath, null)).toEqual({ hello: "world" });
  });

  it("creates missing directories, writes updated json", async () => {
    const path = join(testRoot, "sub", "data.json");
    const result = await updateLockedJsonFile<{ count: number }, string>(
      path,
      { count: 0 },
      (current) => ({ data: { count: current.count + 1 }, result: "updated" }),
    );
    expect(result).toBe("updated");
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ count: 1 });
    expect(
      readdirSync(dirname(path)).filter(
        (name) => name.startsWith(".tmp-") && name.endsWith(".json"),
      ),
    ).toEqual([]);
  });
});
