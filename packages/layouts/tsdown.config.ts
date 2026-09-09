import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/index.ts",
    "src/site-layout.tsx",
    // Its own entry, so the bundle keeps the `"use client"` directive: a
    // module tsdown merges into a shared chunk loses it, and the drawer's
    // `useState` then lands in the server graph.
    "src/site-layout-client.tsx",
    "src/admin/index.ts",
    "src/admin/console-layout-client.tsx",
    "src/admin/console-user-menu.tsx",
    "src/navigation.ts",
  ],
  format: "esm",
});
