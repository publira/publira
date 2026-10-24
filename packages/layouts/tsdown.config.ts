import { requireClientDirectives } from "@publira/tsdown-config/require-client-directives";
import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/admin/console-header/index.ts",
    "src/admin/console-layout/index.ts",
    "src/admin/console-page/index.ts",
    "src/admin/console-section/index.ts",
    "src/admin/console-sidebar/index.ts",
    "src/admin/console-user-menu/index.ts",
    "src/auth-screen/index.ts",
    "src/navigation.ts",
    "src/site-layout/index.ts",
  ],
  format: "esm",
  plugins: [requireClientDirectives()],
  // One output file per source module: a module merged into a shared chunk
  // loses its `"use client"`, and Next.js then runs its hooks in the server graph.
  unbundle: true,
});
