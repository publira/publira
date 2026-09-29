import { defineConfig } from "vitest/config";

const name = "@publira/api-client";

export default defineConfig({
  test: {
    name,
    projects: [{ extends: "../../vitest.shared.ts", test: { name } }],
  },
});
