import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/index.ts",
    "src/api-client.ts",
    "src/auth-shared.ts",
    "src/tenant-resolution.ts",
  ],
  format: "esm",
});
