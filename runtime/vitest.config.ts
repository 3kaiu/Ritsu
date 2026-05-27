import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 在模块加载前设置环境变量，确保 event-validator/schema-compiler 能找到 _shared/
process.env.RITSU_SHARED_DIR = resolve(__dirname, "../_shared");

export default defineConfig({
  resolve: {
    alias: {
      "bun:sqlite": resolve(__dirname, "src/__mocks__/bun-sqlite.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "src/tests/**/*.test.ts"],
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
      exclude: ["dist/**", "node_modules/**", "**/__mocks__/**"],
    },
    typecheck: {
      enabled: false,
    },
  },
});
