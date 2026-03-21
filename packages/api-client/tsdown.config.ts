import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/index.ts",
    "src/public/index.ts",
    "src/public/client.ts",
    "src/public/auth.ts",
    "src/public/catalog.ts",
    "src/public/types.ts",
    "src/admin/index.ts",
    "src/admin/client.ts",
    "src/admin/auth.ts",
    "src/admin/series.ts",
    "src/admin/theme.ts",
    "src/admin/types.ts",
    "src/platform/client.ts",
  ],
  format: "esm",
});
