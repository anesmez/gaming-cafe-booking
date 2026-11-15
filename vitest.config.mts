import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

// Unit tests: fast, no database. Integration tests live in *.int.test.ts.
export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "src/**/*.int.test.ts"],
  },
});
