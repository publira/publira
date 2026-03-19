import type { Config } from "tsdown";

const config: Config = {
  dts: true,
  entry: "src/index.ts",
  format: "esm",
};

export default config;
