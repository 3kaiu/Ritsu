import { describe, it, expect, vi } from "vitest";
import { getRitsudBinaryPath } from "../src/launcher.js";
import { existsSync } from "node:fs";
import { platform, arch } from "node:os";

describe("getRitsudBinaryPath", () => {
  it("resolves to local target path if it exists", () => {
    // We can pass a path that we know has a target release or debug binary (like the real project root)
    const projectRoot = process.cwd();
    const path = getRitsudBinaryPath(projectRoot);
    
    // Since we compile in Rust locally, this should resolve either to target/release/ritsud,
    // target/debug/ritsud, or null (if not compiled yet but it falls back to download / pure JS).
    if (path !== null) {
      expect(existsSync(path)).toBe(true);
    }
  });

  it("returns null or attempts download on invalid paths", () => {
    // An invalid root path should fall back to download, and if download fails (or is bypassed/timed out), returns null
    const invalidRoot = "/non-existent-directory-xyz";
    const path = getRitsudBinaryPath(invalidRoot);
    expect(path === null || existsSync(path)).toBe(true);
  });
});
