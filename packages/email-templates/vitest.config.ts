import { defineConfig } from "vitest/config";

const name = "@publira/email-templates";

export default defineConfig({
  test: {
    name,
    projects: [
      {
        extends: "../../vitest.shared.ts",
        test: {
          name,
          clearMocks: true,
          fileParallelism: false,
          // `react-email` `render()` compiles the template on first use, which
          // costs more than a test budget sized for ordinary work.
          testTimeout: 20_000,
        },
      },
    ],
  },
});
