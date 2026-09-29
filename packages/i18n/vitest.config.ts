import { defineConfig } from "vitest/config";

const name = "@publira/i18n";

export default defineConfig({
  test: {
    name,
    projects: [{ extends: "../../vitest.shared.ts", test: { name } }],
  },
});
