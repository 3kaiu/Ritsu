/**
 * DataStore — Atomic JSON Storage Layer
 *
 * Consolidates the "read JSON → modify → write JSON" pattern that was
 * duplicated 15 times across the codebase into a single generic abstraction.
 *
 * Key differences from raw locked-json.ts:
 *   1. Synchronous API (adequate for local-file storage, simpler callers)
 *   2. update() is a single atomic operation (read → apply → write, no window)
 *   3. Auto-creates parent directories
 *   4. Consistent error handling: returns defaults on read failure
 *
 * v8.5.0
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

// ─── Helpers ──────────────────────────────────────────────────

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeAtomically(filePath: string, data: unknown): void {
  ensureDir(filePath);
  const tmpPath = join(dirname(filePath), `.tmp-${randomUUID()}.json`);
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmpPath, filePath);
}

// ─── DataStore ────────────────────────────────────────────────

export interface DataStoreDefaults<T> {
  (): T;
}

export interface Storable {
  version: number;
  updated_at: string;
}

export class DataStore<T extends Storable> {
  private path: string;
  private defaults: DataStoreDefaults<T>;

  constructor(path: string, defaults: DataStoreDefaults<T>) {
    this.path = path;
    this.defaults = defaults;
  }

  /**
   * Path to the underlying JSON file.
   */
  get filePath(): string {
    return this.path;
  }

  /**
   * Check if the store file exists.
   */
  exists(): boolean {
    return existsSync(this.path);
  }

  /**
   * Read data from the store.
   * If the file doesn't exist or is corrupt, returns defaults.
   */
  read(): T {
    if (!existsSync(this.path)) return clone(this.defaults());
    try {
      const raw = readFileSync(this.path, "utf-8").trim();
      if (!raw) return clone(this.defaults());
      return JSON.parse(raw) as T;
    } catch {
      return clone(this.defaults());
    }
  }

  /**
   * Overwrite the store with new data (atomic write).
   */
  write(data: T): void {
    data.updated_at = new Date().toISOString();
    writeAtomically(this.path, data);
  }

  /**
   * Read, mutate in-place, and write back — atomically.
   * The updater receives the mutable data and modifies it directly.
   * After the updater returns, the data is written atomically to disk.
   */
  update(updater: (data: T) => void): void {
    const current = this.read();
    updater(current);
    current.updated_at = new Date().toISOString();
    writeAtomically(this.path, current);
  }

  /**
   * Delete the store file.
   */
  clear(): void {
    try {
      const { unlinkSync } = require("node:fs") as typeof import("node:fs");
      if (existsSync(this.path)) unlinkSync(this.path);
    } catch {
      // best-effort
    }
  }
}
