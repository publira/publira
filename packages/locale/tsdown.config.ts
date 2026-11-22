import { requireClientDirectives } from "@publira/tsdown-config/require-client-directives";
import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/client-messages.tsx",
    "src/console-locale.ts",
    "src/get-messages.ts",
    "src/locale-cookie.ts",
    "src/locale-field.ts",
    "src/message.ts",
    "src/messages-provider.tsx",
    "src/root-locale.ts",
    "src/static-params.ts",
  ],
  format: "esm",
  plugins: [requireClientDirectives()],
  // One output file per source module: a module merged into a shared chunk
  // loses its `"use client"`, and Next.js then runs its hooks in the server graph.
  unbundle: true,
});
