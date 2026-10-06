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
    "**/gen/**",
    ".agents/skills/**",
    ".devcontainer/devcontainer-lock.json",
    // A Go template Traefik renders when it loads it, and YAML only after
    // that: the routers it writes depend on the hosts in the environment.
    "infra/proxy/traefik/dynamic/routes.yaml",
  ],
  sortTailwindcss,
});
