import { defineConfig } from "oxfmt";
import type { SortTailwindcssUserConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

const sortTailwindcss = (
  typeof ultracite.sortTailwindcss === "boolean"
    ? ultracite.sortTailwindcss
    : {
        ...ultracite.sortTailwindcss,
        stylesheet: "apps/web-host/app/globals.css",
      }
) satisfies SortTailwindcssUserConfig;

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    "**/src/gen/**",
    ".agents/skills/**",
    ".devcontainer/devcontainer-lock.json",
  ],
  sortTailwindcss,
});
