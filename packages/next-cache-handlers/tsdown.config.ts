import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/incremental.ts", "src/use-cache.ts"],
  format: ["esm"],
});
