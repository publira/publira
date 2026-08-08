import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/index.ts",
    "src/cn.ts",
    "src/format-date-time.ts",
    "src/health.ts",
    "src/next-static-params.ts",
    "src/static-param-placeholder.ts",
    "src/theme-css-variables.ts",
  ],
  format: "esm",
});
