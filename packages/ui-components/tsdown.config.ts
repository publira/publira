import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: ["src/index.ts", "src/button.tsx", "src/link-button.tsx"],
  format: "esm",
});
