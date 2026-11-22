import { defineConfig } from "vitest/config";

const name = "@publira/locale";

export default defineConfig({
  test: {
    name,
    projects: [
      {
        extends: "../../vitest.shared.ts",
        test: {
          clearMocks: true,
          name,
        },
      },
    ],
  },
});
