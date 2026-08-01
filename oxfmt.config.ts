import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    "**/src/gen/**",
    ".agents/skills/**",
    ".devcontainer/devcontainer-lock.json",
  ],
});
