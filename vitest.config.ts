import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/test/**/*.test.ts", "packages/**/src/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/**/*.test.ts", "**/index.ts", "**/types.ts", "**/synthetic.ts", "**/benchmark.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@seee/core": pkg("core"),
      "@seee/geometry": pkg("geometry"),
      "@seee/graph": pkg("graph"),
      "@seee/segmentation": pkg("segmentation"),
      "@seee/entity": pkg("entity"),
      "@seee/topology": pkg("topology"),
      "@seee/scene-graph": pkg("scene-graph"),
      "@seee/workers": pkg("workers"),
      "@seee/sdk": pkg("sdk"),
    },
  },
});
