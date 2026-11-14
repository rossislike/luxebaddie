import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["test/unit/**/*.test.ts"] } },
      // Runs against the deployed dev stage. See test/e2e/README in the test file headers.
      { test: { name: "e2e", include: ["test/e2e/**/*.test.ts"], testTimeout: 60_000, fileParallelism: false } },
    ],
  },
});
