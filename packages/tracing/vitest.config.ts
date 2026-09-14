import { defineConfig } from "vitest/config";

const name = "@publira/tracing";

export default defineConfig({
  test: {
    name,
    projects: [{ extends: "../../vitest.shared.ts", test: { name } }],
  },
});
