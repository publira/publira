import { defineConfig } from "vitest/config";

const name = "@publira/utils";

export default defineConfig({
  test: {
    name,
    projects: [
      {
        extends: "../../vitest.shared.ts",
        test: {
          clearMocks: true,
          name,
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
