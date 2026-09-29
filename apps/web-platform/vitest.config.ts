import { defineConfig } from "vitest/config";

const name = "@publira/web-platform";

export default defineConfig({
  test: {
    name,
    projects: [
      {
        extends: "../../vitest.shared.ts",
        /**
         * `@publira/layouts` declares `next` as a peer and carries its own copy
         * in the store, so without this the console shell's `usePathname()`
         * comes from a different module than the one a test mocks — and the
         * mock never reaches it. The browser loads one Next.js; the tests
         * resolve one too.
         */
        resolve: { dedupe: ["next"] },
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
