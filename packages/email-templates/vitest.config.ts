import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    fileParallelism: false,
    setupFiles: ["./vitest.setup.ts"],
    // `react-email` `render()` compiles the template on first use; keep
    // headroom so a contended CI worker does not trip the 5s default.
    testTimeout: 20_000,
  },
});
