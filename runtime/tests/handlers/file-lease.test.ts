import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  checkLease,
  releaseAllForSpan,
  ritsu_claim_file,
  ritsu_list_leases,
  ritsu_release_file,
} from "../../src/handlers/file-lease.js";

describe("file lease handlers", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "ritsu-test-file-lease-"));
    process.env.RITSU_PROJECT_ROOT = testRoot;
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("serializes competing claims for the same file", async () => {
    const [first, second] = await Promise.all([
      ritsu_claim_file({ path: "src/app.ts", span_id: "span-aaaa1111" }),
      ritsu_claim_file({ path: "src/app.ts", span_id: "span-bbbb2222" }),
    ]);

    const firstData = JSON.parse(first.content[0].text as string);
    const secondData = JSON.parse(second.content[0].text as string);
    expect([firstData.ok, secondData.ok].sort()).toEqual([false, true]);

    const leases = await ritsu_list_leases({});
    const leasesData = JSON.parse(leases.content[0].text as string);
    expect(leasesData.leases).toHaveLength(1);
  });

  it("releases a held lease", async () => {
    await ritsu_claim_file({ path: "src/app.ts", span_id: "span-aaaa1111" });
    await ritsu_release_file({ path: "src/app.ts", span_id: "span-aaaa1111" });

    const leases = await ritsu_list_leases({});
    const leasesData = JSON.parse(leases.content[0].text as string);
    expect(leasesData.leases).toHaveLength(0);
  });

  it("allows the same span to renew and filters expired leases", async () => {
    await ritsu_claim_file({
      path: "src/app.ts",
      span_id: "span-aaaa1111",
      ttl_ms: -1,
    });
    const renewed = await ritsu_claim_file({
      path: "src/app.ts",
      span_id: "span-bbbb2222",
    });
    const renewedData = JSON.parse(renewed.content[0].text as string);

    expect(renewedData.ok).toBe(true);

    const leases = await ritsu_list_leases({});
    const leasesData = JSON.parse(leases.content[0].text as string);
    expect(leasesData.leases).toHaveLength(1);
    expect(leasesData.leases[0].span_id).toBe("span-bbbb2222");
  });

  it("supports releasing all leases for a span and checking lock ownership", async () => {
    await ritsu_claim_file({ path: "src/a.ts", span_id: "span-aaaa1111" });
    await ritsu_claim_file({ path: "src/b.ts", span_id: "span-aaaa1111" });
    await ritsu_claim_file({ path: "src/c.ts", span_id: "span-cccc3333" });

    expect(checkLease(testRoot, "src/a.ts", "span-aaaa1111")).toEqual({ ok: true });
    expect(checkLease(testRoot, "src/c.ts", "span-aaaa1111")).toEqual({
      ok: false,
      message: "File is locked by span span-cccc3333",
    });

    await releaseAllForSpan(testRoot, "span-aaaa1111");

    const leases = await ritsu_list_leases({});
    const leasesData = JSON.parse(leases.content[0].text as string);
    expect(leasesData.leases).toHaveLength(1);
    expect(leasesData.leases[0].path).toBe("src/c.ts");
  });

  it("drops expired leases from list output even when persisted on disk", async () => {
    const leaseDir = resolve(testRoot, ".ritsu");
    mkdirSync(leaseDir, { recursive: true });
    writeFileSync(
      resolve(leaseDir, "leases.json"),
      JSON.stringify(
        [
          {
            path: "src/expired.ts",
            span_id: "span-old",
            expires_at: Date.now() - 1000,
          },
          {
            path: "src/live.ts",
            span_id: "span-live",
            expires_at: Date.now() + 60_000,
          },
        ],
        null,
        2,
      ),
      "utf-8",
    );

    const leases = await ritsu_list_leases({});
    const leasesData = JSON.parse(leases.content[0].text as string);
    expect(leasesData.leases).toEqual([
      expect.objectContaining({
        path: "src/live.ts",
        span_id: "span-live",
      }),
    ]);
  });
});
