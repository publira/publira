import type { ComponentType, ReactNode, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavItem {
  href: string;
  label: ReactNode;
  icon: IconComponent;
  /**
   * Optional marker beside the label — a queue size, say. A node rather than a
   * number, so the console that owns the item decides what it counts, how the
   * count is worded for a screen reader, and which `<Suspense>` it resolves
   * behind.
   */
  badge?: ReactNode;
}

export interface NavSection {
  /** Stable list key when `title` is not a string. */
  id?: string;
  title: ReactNode;
  items: NavItem[];
}

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

/**
 * Every href a console's navigation offers.
 *
 * {@link isCurrentPath} needs the whole set to decide which of two matching
 * items owns the active state, and the sections are what a console already has
 * to hand when it renders the sidebar.
 */
export const navigationHrefs = (sections: readonly NavSection[]): string[] =>
  sections.flatMap((section) => section.items.map((item) => item.href));

/** The `[tenant_id]` segment `web-admin`'s proxy writes in front of a path. */
const TENANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * The path a navigation href is written against, from a value read out of
 * `usePathname()`.
 *
 * `web-admin` is served behind a rewrite that puts the tenant id in front of
 * every path, so a server-rendered shell reports `/{tenantId}/series` while the
 * browser reports `/series` — the mismatch Next.js documents under "Avoid
 * hydration mismatch with rewrites". Dropping a leading tenant id leaves the
 * same path on both sides of hydration, so the item that renders as the current
 * one does not change when the shell hydrates. `web-platform` has no such
 * segment, and no console path is a bare UUID, so its pathnames come back
 * unchanged.
 */
export const toConsolePathname = (pathname: string): string => {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const [first] = segments;
  const rest =
    first !== undefined && TENANT_ID_PATTERN.test(first.toLowerCase())
      ? segments.slice(1)
      : segments;

  return rest.length === 0 ? "/" : `/${rest.join("/")}`;
};
