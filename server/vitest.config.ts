import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    // Strip .js extensions so Vite resolves TypeScript source files
    alias: [{ find: /^(\..+)\.js$/, replacement: "$1" }],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/index.ts"],
    },
    // Mock heavy side-effectful modules so pure-logic tests don't need a DB
    alias: {
      [path.resolve(__dirname, "src/db")]: path.resolve(
        __dirname,
        "src/__tests__/__mocks__/db.ts"
      ),
    },
  },
});
