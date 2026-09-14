import { defineConfig } from "vitest/config";

const name = "@publira/web-host";

export default defineConfig({
  test: {
    name,
    projects: [
      {
        extends: "../../vitest.shared.ts",
        test: {
          clearMocks: true,
          environment: "node",
          name,
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
