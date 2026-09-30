import appleIcon from "@publira/brand/logo-mark/apple-icon-180.png";
import icon32 from "@publira/brand/logo-mark/icon-32.png";
import icon192 from "@publira/brand/logo-mark/icon-192.png";
import type { Metadata } from "next";

/**
 * The console's favicon and apple icon: the Publira mark as `@publira/brand`
 * renders it, bundled from there so replacing the mark in that package is the
 * only change this console needs. The console belongs to no tenant, so unlike
 * the storefront it has no tenant icon to prefer.
 *
 * Every document declares them: `app/layout.tsx` and `app/global-not-found.tsx`,
 * which bypasses that layout.
 */
export const platformIcons = {
  apple: [{ sizes: "180x180", type: "image/png", url: appleIcon.src }],
  icon: [
    { sizes: "32x32", type: "image/png", url: icon32.src },
    { sizes: "192x192", type: "image/png", url: icon192.src },
  ],
} satisfies Metadata["icons"];
