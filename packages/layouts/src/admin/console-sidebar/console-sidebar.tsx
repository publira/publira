import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Held to the viewport, so a navigation taller than the screen scrolls on its
 * own. Drawn from `md`, the narrowest tablet held upright, so the drawer and
 * its floating button are a phone's alone: a tablet has the width for the
 * sidebar in either orientation, and the button would sit over its content.
 */
export const ConsoleSidebar = ({ children }: { children: ReactNode }) => (
  <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-4 md:flex">
    {children}
  </aside>
);

export const ConsoleSidebarBrand = ({ children }: { children: ReactNode }) => (
  <div className="flex min-w-0 items-center px-3">
    <Link
      className="flex min-w-0 items-center rounded-control focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:min-h-11"
      href="/"
    >
      {children}
    </Link>
  </div>
);

export const ConsoleSidebarBrandName = ({
  children,
}: {
  children: ReactNode;
}) => (
  <p className="truncate font-serif text-lg font-semibold text-foreground">
    {children}
  </p>
);

/** What this console is operating, in a sentence-case line under the brand. */
export const ConsoleSidebarContext = ({
  children,
}: {
  children: ReactNode;
}) => (
  <p className="mt-1 truncate px-3 text-sm text-muted-foreground">{children}</p>
);

export const ConsoleSidebarNavigationSection = ({
  children,
}: {
  children: ReactNode;
}) => <div className="grid gap-1">{children}</div>;

export const ConsoleSidebarNavigationTitle = ({
  children,
}: {
  children: ReactNode;
}) => (
  <p className="px-3 text-xs font-medium text-muted-foreground">{children}</p>
);

export const ConsoleSidebarNavigationItems = ({
  children,
}: {
  children: ReactNode;
}) => <div className="grid">{children}</div>;

/**
 * The item's icon, at the grey of secondary text until the item is the current
 * page, where it takes the same Ai as the rule down its left edge.
 */
export const ConsoleSidebarNavigationItemIcon = ({
  children,
}: {
  children: ReactNode;
}) => (
  <span className="flex shrink-0 text-muted-foreground group-aria-[current=page]:text-primary">
    {children}
  </span>
);

/**
 * The label row of a navigation item: the label itself, plus whatever the
 * console puts beside it. A slot rather than a `badge` prop on the item, so an
 * item with nothing to show renders exactly the markup it did before.
 */
export const ConsoleSidebarNavigationItemHeading = ({
  children,
}: {
  children: ReactNode;
}) => (
  <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
);

export const ConsoleSidebarNavigationItemLabel = ({
  children,
}: {
  children: ReactNode;
}) => <span className="truncate">{children}</span>;
