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
    // The first import of the app in a cold run transforms the whole module
    // graph inside beforeAll and can exceed the 10s default.
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@fintrack/types": path.resolve(
        import.meta.dirname,
        "../../packages/types/src/index.ts",
      ),
      ioredis: path.resolve(import.meta.dirname, "./test/mocks/ioredis.ts"),
    },
  },
});
