import { readFile } from "node:fs/promises";

import { defineConfig } from "vitest/config";

const name = "@publira/web-storefront";

const BYTES_QUERY = "?bytes";

export default defineConfig({
  test: {
    name,
    projects: [
      {
        extends: "../../vitest.shared.ts",
        plugins: [
          // The `?bytes` rule `next.config.ts` gives Turbopack: a file
          // imported with it is a `Uint8Array` of its contents, not a URL.
          {
            enforce: "pre",
            async load(id) {
              if (!id.endsWith(BYTES_QUERY)) {
                return null;
              }

              const data = await readFile(id.slice(0, -BYTES_QUERY.length));

              return `export default Uint8Array.from(atob(${JSON.stringify(data.toString("base64"))}), (character) => character.charCodeAt(0));`;
            },
            name: "bytes-imports",
          },
        ],
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
