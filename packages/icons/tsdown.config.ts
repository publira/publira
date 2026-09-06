import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/index.ts",
    "src/bell-icon.tsx",
    "src/chart-icon.tsx",
    "src/check-icon.tsx",
    "src/chevron-down-icon.tsx",
    "src/chevron-left-icon.tsx",
    "src/chevron-right-icon.tsx",
    "src/close-icon.tsx",
    "src/collection-icon.tsx",
    "src/comment-icon.tsx",
    "src/dashboard-icon.tsx",
    "src/image-icon.tsx",
    "src/logout-icon.tsx",
    "src/maximize-icon.tsx",
    "src/menu-icon.tsx",
    "src/minimize-icon.tsx",
    "src/settings-icon.tsx",
    "src/user-icon.tsx",
  ],
  format: "esm",
});
