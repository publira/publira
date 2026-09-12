import { Skeleton } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { ConsoleLayoutClient } from "./console-layout-client";

export {
  ConsoleMobileNavigation,
  ConsoleMobileNavigationCloseButton,
  ConsoleMobileNavigationOpenButton,
  ConsoleSidebarNavigation,
  ConsoleSidebarNavigationItem,
} from "./console-layout-client";

export const ConsoleLayout = ({ children }: { children: ReactNode }) => (
  <ConsoleLayoutClient>{children}</ConsoleLayoutClient>
);

export const ConsoleLayoutMain = ({ children }: { children: ReactNode }) => (
  <main className="flex-1 overflow-x-hidden">{children}</main>
);

export const ConsoleLayoutContent = ({ children }: { children: ReactNode }) => (
  <div className="flex min-w-0 flex-1 flex-col">{children}</div>
);

export const ConsoleHeaderSkeleton = () => (
  <header className="sticky top-0 z-20 border-b border-border bg-background">
    <div className="mx-auto flex h-12 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
      <Skeleton className="h-4 w-40 rounded-control" />
      <Skeleton className="h-6 w-20 rounded-control" />
    </div>
  </header>
);

export const ConsoleSidebarSkeleton = () => (
  <aside
    aria-hidden="true"
    className="hidden w-60 flex-col border-r border-border bg-surface px-3 py-4 lg:flex"
  >
    <div className="grid gap-3 px-3">
      <Skeleton className="h-6 w-32 rounded-control" />
      <Skeleton className="h-4 w-24 rounded-control" />
    </div>
    <div className="mt-6 grid gap-2 px-3">
      <Skeleton className="h-4 w-20 rounded-control" />
      <Skeleton className="h-40 w-full rounded-control" />
    </div>
  </aside>
);

export const ConsoleLayoutSkeleton = () => (
  <div className="flex min-h-dvh bg-background text-foreground">
    <ConsoleSidebarSkeleton />
    <ConsoleLayoutContent>
      <ConsoleHeaderSkeleton />
      <ConsoleLayoutMain>
        <div className="p-8" />
      </ConsoleLayoutMain>
    </ConsoleLayoutContent>
  </div>
);

export const ConsoleHeaderUserSkeleton = () => (
  <Skeleton className="size-9 rounded-control" />
);

/** A 48px bar: what the console is showing on the left, its controls on the right. */
export const ConsoleHeader = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<ConsoleHeaderSkeleton />}>
    <header className="sticky top-0 z-20 border-b border-border bg-background">
      <div className="mx-auto flex h-12 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {children}
      </div>
    </header>
  </Suspense>
);

export const ConsoleHeaderContext = ({ children }: { children: ReactNode }) => (
  <div className="flex min-w-0 items-center gap-2">{children}</div>
);

export const ConsoleHeaderText = ({ children }: { children: ReactNode }) => (
  <div className="min-w-0">{children}</div>
);

export const ConsoleHeaderLabel = ({ children }: { children: ReactNode }) => (
  <p className="truncate text-sm font-medium text-foreground">{children}</p>
);

export const ConsoleHeaderActions = ({ children }: { children: ReactNode }) => (
  <div className="flex items-center gap-2">{children}</div>
);

export const ConsoleSidebar = ({ children }: { children: ReactNode }) => (
  <aside className="hidden w-60 flex-col border-r border-border bg-surface px-3 py-4 lg:flex">
    {children}
  </aside>
);

export const ConsoleSidebarBrand = ({ children }: { children: ReactNode }) => (
  <div className="flex min-w-0 items-center px-3">
    <Link
      className="min-w-0 rounded-control focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
