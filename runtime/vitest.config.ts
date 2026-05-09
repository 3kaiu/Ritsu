import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 在模块加载前设置环境变量，确保 event-validator/schema-compiler 能找到 _shared/
process.env.RITSU_SHARED_DIR = resolve(__dirname, "../_shared");

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    typecheck: {
      enabled: false,
    },
  },
});
