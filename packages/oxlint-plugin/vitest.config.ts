import { defineConfig } from "vitest/config";

const name = "@publira/oxlint-plugin";

export default defineConfig({
  test: {
    name,
    projects: [{ extends: "../../vitest.shared.ts", test: { name } }],
  },
});
