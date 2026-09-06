import { sharedTestOptions } from "@publira/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    ...sharedTestOptions,
    clearMocks: true,
    fileParallelism: false,
    setupFiles: ["./vitest.setup.ts"],
    // `react-email` `render()` compiles the template on first use, which costs
    // more than a test budget sized for ordinary work.
    testTimeout: 20_000,
  },
});
