import { defineConfig } from "tsdown";

export default defineConfig({
  dts: {
    // `./catalog` publishes the declarations in
    // `src/__generated__/locale-message-types.d.ts`, so its entry emits none:
    // they would name the locale catalogs, and Oxc cannot declare a JSON module.
    entry: ["src/index.ts", "src/__generated__/locale-messages.ts"],
  },
  entry: [
    "src/index.ts",
    "src/catalog.ts",
    "src/__generated__/locale-messages.ts",
  ],
  format: "esm",
});
