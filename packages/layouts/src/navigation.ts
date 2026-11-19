import { isLocale } from "@publira/i18n";

export const isCurrentPath = (
  pathname: string,
  href: string,
  allHrefs?: readonly string[]
): boolean => {
  if (href === "/") {
    return pathname === href;
  }

  if (pathname === href) {
    return true;
  }

  if (!pathname.startsWith(`${href}/`)) {
    return false;
  }

  // The prefix matches, but a more specific nav item may match too; that one
  // owns the active state, so this item stays inactive.
  if (allHrefs) {
    return !allHrefs.some(
      (other) =>
        other !== href &&
        other.startsWith(`${href}/`) &&
        (pathname === other || pathname.startsWith(`${other}/`))
    );
  }

  return true;
};

/** The `[tenant_id]` segment `web-admin`'s proxy writes in front of a path. */
const TENANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * The path a navigation href is written against, from a value read out of
 * `usePathname()`.
 *
 * Both consoles are served behind a rewrite that puts segments in front of
 * every path the browser shows: `web-admin`'s proxy writes in the tenant id,
 * and the consoles' proxies write in the `[locale]` root segment they resolved
 * from the locale cookie. A server-rendered shell therefore reports
 * `/{tenantId}/series` or `/ja/tenants` while the browser reports `/series` or
 * `/tenants` — the mismatch Next.js documents under "Avoid hydration mismatch
 * with rewrites". Dropping a leading tenant id, and then a leading locale,
 * leaves the same path on both sides of hydration, so the item that renders as
 * the current one does not change when the shell hydrates. No console path is
 * a bare UUID or starts with a locale, so a path without either comes back
 * unchanged.
 */
export const toConsolePathname = (pathname: string): string => {
  let segments = pathname.split("/").filter((segment) => segment.length > 0);

  if (
    segments[0] !== undefined &&
    TENANT_ID_PATTERN.test(segments[0].toLowerCase())
  ) {
    segments = segments.slice(1);
  }

  if (isLocale(segments[0])) {
    segments = segments.slice(1);
  }

  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
};
