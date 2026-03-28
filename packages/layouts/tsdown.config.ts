import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/index.ts",
    "src/site-layout.tsx",
    "src/admin/index.ts",
    "src/admin/console-layout-client.tsx",
    "src/navigation.ts",
  ],
  format: "esm",
});
