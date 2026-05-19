import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getOrCreateKey,
  initKey,
  signEvent,
  verifyEvent,
} from "../../src/policy/signature.js";

describe("policy signature", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-signature-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("creates and reuses the trust key", () => {
    expect(getOrCreateKey()).toBeNull();

    const key = initKey();

    expect(key).toHaveLength(64);
    expect(getOrCreateKey()).toBe(key);
  });

  it("signs and verifies trace events", () => {
    const key = initKey();
    const event = {
      ts: "2026-05-01T12:00:00.000Z",
      trace_id: "trace-123",
      span_id: "span-456",
      status: "done",
      artifact: "design-sheet-123.md",
    };

    const signature = signEvent(event, key);
    const badPrefix = signature.startsWith("a") ? "b" : "a";

    expect(verifyEvent({ ...event, signature }, key)).toBe(true);
    expect(
      verifyEvent(
        { ...event, signature: `${badPrefix}${signature.slice(1)}` },
        key,
      ),
    ).toBe(false);
    expect(verifyEvent(event, key)).toBe(false);
  });
});
