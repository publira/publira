import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/index.ts",
    "src/site-layout.tsx",
    "src/admin/index.ts",
    "src/admin/console-layout-client.tsx",
    // Its own entry so the server components that share it keep out of the
    // "use client" chunk the layout's client half is bundled into.
    "src/admin/console-theme.ts",
    "src/admin/console-user-menu.tsx",
    "src/navigation.ts",
  ],
  format: "esm",
});
