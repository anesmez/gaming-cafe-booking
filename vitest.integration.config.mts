import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

// Integration tests: run against an in-memory MongoDB replica set.
export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
