import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Strip .js extensions so Vite resolves TypeScript source files
    alias: [{ find: /^(\..+)\.js$/, replacement: "$1" }],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
