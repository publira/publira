import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/index.ts",
    "src/cn.ts",
    "src/format-date-time.ts",
    "src/form-action.ts",
    "src/next-static-params.ts",
  ],
  format: "esm",
});
