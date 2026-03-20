import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/index.ts",
    "src/close-icon.tsx",
    "src/collection-icon.tsx",
    "src/dashboard-icon.tsx",
    "src/menu-icon.tsx",
    "src/settings-icon.tsx",
  ],
  format: "esm",
});
