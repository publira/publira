import { defineConfig } from "oxfmt";
import type { OxfmtConfig, SortTailwindcssUserConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

// `true` or `false` turns the preset's sorting on or off as a whole, with no
// options to add a stylesheet to.
const isSortSwitch = (
  value: OxfmtConfig["sortTailwindcss"]
): value is boolean => typeof value === "boolean";

const sortTailwindcss = (
  isSortSwitch(ultracite.sortTailwindcss)
    ? ultracite.sortTailwindcss
    : {
        ...ultracite.sortTailwindcss,
        stylesheet: "apps/web-storefront/app/globals.css",
      }
) satisfies SortTailwindcssUserConfig;

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    "**/gen/**",
    ".agents/skills/**",
    ".devcontainer/devcontainer-lock.json",
    // A Go template Traefik renders when it loads it, and YAML only after
    // that: the routers it writes depend on the hosts in the environment.
    "infra/proxy/traefik/dynamic/routes.yaml",
  ],
  sortTailwindcss,
});
