import { defineConfig } from "tsdown";

export default defineConfig({
  dts: true,
  entry: [
    "src/index.ts",
    "src/badge/index.ts",
    "src/button/index.ts",
    "src/card/index.ts",
    "src/checkbox/index.ts",
    "src/dialog/index.ts",
    "src/empty-state/index.ts",
    "src/field/index.ts",
    "src/form-actions/index.ts",
    "src/form-message/index.ts",
    "src/input/index.ts",
    "src/radio-group/index.ts",
    "src/select/index.ts",
    "src/skeleton/index.ts",
    "src/switch/index.ts",
    "src/table/index.ts",
    "src/textarea/index.ts",
  ],
  format: "esm",
});
