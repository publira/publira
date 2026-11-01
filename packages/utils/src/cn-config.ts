import type { ConfigExtension } from "cn/config";
import { fromTheme } from "cn/config";

/**
 * What `cn` adds to the default merge config so that it resolves every token
 * `@publira/brand/theme.css` defines.
 *
 * The default config matches a color or a font family by any name, but it
 * enumerates the names of most other scales, so a token the brand adds to one
 * of those is not recognized as a member of its class group: `cn("rounded-md",
 * "rounded-control")` keeps both, and the last one written no longer wins.
 * Each such name is listed here under its scale.
 *
 * `--transition-duration-*` and `--max-width-*` have no scale in the default
 * config at all, so each gets one named after its Tailwind namespace, read by
 * the class group of the one utility Tailwind generates from it.
 *
 * `cn-config.test.ts` reads the stylesheet and fails on a token this misses.
 */
export const cnConfigExtension = {
  extend: {
    classGroups: {
      duration: [{ duration: [fromTheme("transition-duration")] }],
      "max-w": [{ "max-w": [fromTheme("max-width")] }],
    },
    theme: {
      ease: ["state"],
      leading: ["reading-cjk", "reading-latin"],
      "max-width": ["measure-prose"],
      radius: ["control", "surface"],
      shadow: ["floating"],
      "transition-duration": ["state"],
    },
  },
} satisfies ConfigExtension;
