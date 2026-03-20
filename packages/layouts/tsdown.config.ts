import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: ["src/index.ts", "src/site-layout.tsx"],
  format: "esm",
});
