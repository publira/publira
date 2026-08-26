import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: ["src/index.ts", "src/catalog.ts", "src/gen/locale-messages.ts"],
  format: "esm",
});
