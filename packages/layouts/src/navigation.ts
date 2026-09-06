import type { ComponentType, ReactNode, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavItem {
  href: string;
  label: ReactNode;
  description: ReactNode;
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
  allHrefs?: string[]
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
