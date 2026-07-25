import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "artifacts/coverage",
    },
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
          exclude: [
            "**/*.node.test.ts",
            "**/*.dom.test.ts",
            "**/*.ui.test.tsx",
          ],
        },
      },
      {
        test: {
          name: "node",
          environment: "node",
          include: ["**/*.node.test.ts"],
        },
      },
      {
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["**/*.dom.test.ts", "**/*.ui.test.tsx"],
          setupFiles: ["./tests/setup-dom.ts"],
        },
      },
      {
        test: {
          name: "performance",
          environment: "node",
          include: ["tests/performance/**/*.test.ts"],
        },
      },
    ],
  },
});
