import { defineConfig } from "vitest/config";

const name = "@publira/comic-viewer-shell";

export default defineConfig({
  test: {
    name,
    projects: [
      {
        extends: "../../vitest.shared.ts",
        test: { name, setupFiles: ["./vitest.setup.ts"] },
      },
    ],
  },
});
