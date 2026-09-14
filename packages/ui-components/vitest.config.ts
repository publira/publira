import { defineConfig } from "vitest/config";

const name = "@publira/ui-components";

export default defineConfig({
  test: {
    name,
    projects: [{ extends: "../../vitest.shared.ts", test: { name } }],
  },
});
