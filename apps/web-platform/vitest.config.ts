import { sharedTestOptions } from "@publira/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    ...sharedTestOptions,
    clearMocks: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
