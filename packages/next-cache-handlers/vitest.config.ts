import { defineConfig } from "vitest/config";

const name = "@publira/next-cache-handlers";

export default defineConfig({
  test: {
    name,
    projects: [{ extends: "../../vitest.shared.ts", test: { name } }],
  },
});
