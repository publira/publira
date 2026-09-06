import { sharedTestOptions } from "@publira/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    ...sharedTestOptions,
    clearMocks: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
