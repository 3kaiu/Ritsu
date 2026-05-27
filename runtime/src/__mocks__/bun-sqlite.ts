/**
 * bun:sqlite mock for vitest/Node.js test environment.
 *
 * bun:sqlite is a Bun built-in module that cannot be resolved
 * when tests run under Node.js (vitest's default). This mock
 * provides minimal Database class compatible with Ritsu's usage.
 *
 * Actual SQLite operations are NOT performed — the mock returns
 * empty/fake results sufficient for tests to load without error.
 *
 * v8.6.0
 */

interface StatementMock {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown | null;
  finalize(): void;
}

const noopStatement: StatementMock = {
  run() { return { changes: 0, lastInsertRowid: 0 }; },
  all() { return []; },
  get() { return null; },
  finalize() {},
};

export class Database {
  public path: string;
  public memory: boolean;
  private tables: Map<string, Array<Record<string, unknown>>> = new Map();

  constructor(pathOrOptions: string | { path?: string; memory?: boolean }, _options?: unknown) {
    if (typeof pathOrOptions === "string") {
      this.path = pathOrOptions;
      this.memory = false;
    } else {
      this.path = pathOrOptions?.path ?? ":memory:";
      this.memory = pathOrOptions?.memory ?? true;
    }
  }

  exec(_sql: string): void {
    // no-op
  }

  run(_sql: string, ..._params: unknown[]): { changes: number; lastInsertRowid: number } {
    return { changes: 0, lastInsertRowid: 0 };
  }

  prepare(sql: string): StatementMock {
    const tables = this.tables;
    // Track simple CREATE TABLE statements
    const createMatch = sql.match(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i);
    if (createMatch) {
      tables.set(createMatch[1].toLowerCase(), []);
    }
    // Track INSERT
    const insertMatch = sql.match(/INSERT INTO (\w+)/i);
    if (insertMatch) {
      const table = insertMatch[1].toLowerCase();
      if (!tables.has(table)) tables.set(table, []);
      return {
        run(...params: unknown[]) {
          const existing = tables.get(table) ?? [];
          existing.push({ row: params });
          return { changes: 1, lastInsertRowid: existing.length };
        },
        all() { return tables.get(table) ?? []; },
        get() { return tables.get(table)?.[0] ?? null; },
        finalize() {},
      };
    }
    return noopStatement;
  }

  close(): void {
    this.tables.clear();
  }

  serialize(): Uint8Array {
    return new Uint8Array(0);
  }

  query(sql: string): unknown[] {
    return [];
  }
}

export default Database;
