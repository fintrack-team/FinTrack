import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    globals: true,
    clearMocks: true,
    // Integration suites share one Postgres database.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@fintrack/types": path.resolve(
        __dirname,
        "../../packages/types/src/index.ts",
      ),
      ioredis: path.resolve(__dirname, "./test/mocks/ioredis.ts"),
    },
  },
});
