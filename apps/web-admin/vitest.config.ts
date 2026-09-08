import { sharedTestOptions } from "@publira/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  /**
   * `@publira/layouts` declares `next` as a peer and carries its own copy in
   * the store, so without this the console shell's `usePathname()` comes from a
   * different module than the one a test mocks — and the mock never reaches it.
   * The browser loads one Next.js; the tests resolve one too.
   */
  resolve: { dedupe: ["next"] },
  test: {
    ...sharedTestOptions,
    clearMocks: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
