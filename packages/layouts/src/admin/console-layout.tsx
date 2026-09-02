import { Skeleton } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { ConsoleLayoutClient } from "./console-layout-client";
import { consoleBackgroundClassName } from "./console-theme";
import type { ConsoleTheme } from "./console-theme";

export {
  ConsoleMobileNavigation,
  ConsoleMobileNavigationCloseButton,
  ConsoleMobileNavigationOpenButton,
} from "./console-layout-client";
export type { ConsoleTheme } from "./console-theme";

export interface ConsoleLayoutProps {
  children: ReactNode;
  theme: ConsoleTheme;
}

export const ConsoleLayoutSkeleton = ({ theme }: { theme: ConsoleTheme }) => (
  <div className="relative min-h-dvh bg-background text-foreground">
    <div
      aria-hidden="true"
      className={consoleBackgroundClassName}
      data-console-theme={theme}
    />
    <div className="relative flex min-h-dvh">
      <aside
        aria-hidden="true"
        className="hidden w-72 max-w-none flex-col border-r border-border/70 bg-card/95 px-4 py-4 lg:flex"
      >
        <div className="grid gap-3">
          <Skeleton className="h-5 w-24 rounded" />
          <Skeleton className="h-4 w-40 rounded" />
          <Skeleton className="h-48 w-full rounded" />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col lg:pl-0">
        <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 px-4 py-4 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
            <Skeleton className="h-6 w-48 rounded" />
            <Skeleton className="h-6 w-24 rounded" />
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden">
          <div className="p-8" />
        </main>
      </div>
    </div>
  </div>
);

export const ConsoleLayout = ({ children, theme }: ConsoleLayoutProps) => (
  <ConsoleLayoutClient theme={theme}>{children}</ConsoleLayoutClient>
);

export const ConsoleLayoutMain = ({ children }: { children: ReactNode }) => (
  <main className="flex-1 overflow-x-hidden">{children}</main>
);

export const ConsoleLayoutContent = ({ children }: { children: ReactNode }) => (
  <div className="flex min-w-0 flex-1 flex-col lg:pl-0">{children}</div>
);

export const ConsoleHeaderSkeleton = () => (
  <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 px-4 py-4 backdrop-blur">
    <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
      <Skeleton className="h-6 w-48 rounded" />
      <Skeleton className="h-6 w-24 rounded" />
    </div>
  </header>
);

export const ConsoleSidebarSkeleton = () => (
  <aside
    className="hidden w-72 max-w-none flex-col border-r border-border/70 bg-card/95 px-4 py-4 lg:flex"
    aria-hidden="true"
  >
    <div className="grid gap-3">
      <Skeleton className="h-5 w-24 rounded" />
      <Skeleton className="h-4 w-40 rounded" />
      <Skeleton className="h-48 w-full rounded" />
    </div>
  </aside>
);

export const ConsoleHeaderUserSkeleton = () => (
  <Skeleton className="size-9 rounded-full" />
);

export const ConsoleHeader = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<ConsoleHeaderSkeleton />}>
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        {children}
      </div>
    </header>
  </Suspense>
);

export const ConsoleHeaderContext = ({ children }: { children: ReactNode }) => (
  <div className="flex min-w-0 items-center gap-3">{children}</div>
);

export const ConsoleHeaderText = ({ children }: { children: ReactNode }) => (
  <div className="min-w-0">{children}</div>
);

export const ConsoleHeaderEyebrow = ({ children }: { children: ReactNode }) => (
  <p className="text-xs tracking-[0.24em] text-muted-foreground uppercase">
    {children}
  </p>
);

export const ConsoleHeaderLabel = ({ children }: { children: ReactNode }) => (
  <p className="truncate text-sm font-medium text-foreground sm:text-base">
    {children}
  </p>
);

export const ConsoleHeaderActions = ({ children }: { children: ReactNode }) => (
  <div className="flex items-center gap-2 sm:gap-3">{children}</div>
);

export const ConsoleSidebar = ({ children }: { children: ReactNode }) => (
  <aside className="hidden w-72 max-w-none flex-col border-r border-border/70 bg-card/95 px-4 py-4 lg:flex">
    {children}
  </aside>
);

export const ConsoleSidebarBrand = ({ children }: { children: ReactNode }) => (
  <div className="flex items-center justify-between gap-3 px-2 pb-4">
    <Link className="min-w-0" href="/">
      {children}
    </Link>
  </div>
);

export const ConsoleSidebarBrandName = ({
  children,
}: {
  children: ReactNode;
}) => (
  <p className="font-serif text-xl font-semibold tracking-tight text-foreground">
    {children}
  </p>
);

export const ConsoleSidebarBrandLabel = ({
  children,
}: {
  children: ReactNode;
}) => (
  <p className="text-xs tracking-[0.22em] text-muted-foreground uppercase">
    {children}
  </p>
);

export const ConsoleSidebarContext = ({
  children,
}: {
  children: ReactNode;
}) => (
  <div className="rounded-2xl border border-border/70 bg-muted/45 p-4">
    {children}
  </div>
);

export const ConsoleSidebarNavigation = ({
  children,
}: {
  children: ReactNode;
}) => (
  <nav className="mt-6 flex-1 overflow-y-auto">
    <div className="grid gap-5">{children}</div>
  </nav>
);

export const ConsoleSidebarNavigationSection = ({
  children,
}: {
  children: ReactNode;
}) => <div className="grid gap-2">{children}</div>;

export const ConsoleSidebarNavigationTitle = ({
  children,
}: {
  children: ReactNode;
}) => (
  <p className="px-2 text-xs font-medium tracking-[0.22em] text-muted-foreground uppercase">
    {children}
  </p>
);

export const ConsoleSidebarNavigationItems = ({
  children,
}: {
  children: ReactNode;
}) => <div className="grid gap-1.5">{children}</div>;

export const ConsoleSidebarNavigationItem = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => (
  <Link
    className="group grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-3 rounded-2xl border px-3 py-3 text-muted-foreground transition-colors hover:border-border/70 hover:bg-muted/55 hover:text-foreground"
    href={href}
  >
    {children}
  </Link>
);

export const ConsoleSidebarNavigationIcon = ({
  children,
}: {
  children: ReactNode;
}) => (
  <span className="flex size-11 items-center justify-center rounded-2xl border border-border/70 bg-card text-muted-foreground group-hover:border-border group-hover:text-foreground">
    {children}
  </span>
);

export const ConsoleSidebarNavigationContent = ({
  children,
}: {
  children: ReactNode;
}) => <span className="grid gap-1">{children}</span>;

export const ConsoleSidebarNavigationItemLabel = ({
  children,
}: {
  children: ReactNode;
}) => <span className="text-sm font-medium">{children}</span>;

export const ConsoleSidebarNavigationItemDescription = ({
  children,
}: {
  children: ReactNode;
}) => (
  <span className="text-xs leading-5 text-muted-foreground group-hover:text-muted-foreground">
    {children}
  </span>
);

export const ConsoleSidebarFooter = ({ children }: { children: ReactNode }) => (
  <div className="mt-6 rounded-2xl border border-border/70 bg-card p-4">
    {children}
  </div>
);
