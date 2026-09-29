import { requireClientDirectives } from "@publira/tsdown-config/require-client-directives";
import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/index.ts",
    "src/site-layout.tsx",
    "src/auth-screen.tsx",
    "src/admin/index.ts",
    "src/navigation.ts",
  ],
  format: "esm",
  plugins: [requireClientDirectives()],
  // One output file per source module: a module merged into a shared chunk
  // loses its `"use client"`, and Next.js then runs its hooks in the server graph.
  unbundle: true,
});
