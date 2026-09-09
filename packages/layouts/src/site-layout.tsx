import { Skeleton } from "@publira/ui-components/skeleton";
import Link from "next/link";
import type { ReactNode } from "react";

export const SiteLayout = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-dvh flex-col bg-background text-foreground">
    {children}
  </div>
);

/**
 * A 56px band a half step above the page, closed by one hairline. The band is
 * what separates the header from the paper; nothing is layered over the content
 * scrolling beneath it, so it needs neither a translucent fill nor a blur.
 */
export const SiteLayoutHeader = ({ children }: { children: ReactNode }) => (
  <header className="border-b border-border bg-surface">
    <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-6">
      {children}
    </div>
  </header>
);

export const SiteLayoutBrand = ({
  children,
  href = "/",
}: {
  children: ReactNode;
  href?: string;
}) => (
  <Link
    className="inline-flex min-w-0 items-center truncate font-serif text-lg font-medium text-foreground transition-colors duration-state ease-state hover:text-muted-foreground"
    href={href}
  >
    {children}
  </Link>
);

export const SiteLayoutBrandSkeleton = () => (
  <Skeleton className="inline-block h-5 w-24 rounded-control" />
);

export const SiteLayoutNav = ({ children }: { children: ReactNode }) => (
  <nav className="hidden items-center gap-5 text-sm text-foreground md:flex">
    {children}
  </nav>
);

export const SiteLayoutNavLink = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => (
  <Link className="underline-offset-4 hover:underline" href={href}>
    {children}
  </Link>
);

export const SiteLayoutMain = ({ children }: { children: ReactNode }) => (
  <main className="flex-1">{children}</main>
);

export const SiteLayoutHeaderActions = ({
  children,
}: {
  children: ReactNode;
}) => children;

export const SiteLayoutHeaderActionsSkeleton = () => (
  <div aria-busy="true" aria-live="polite" className="flex items-center gap-2">
    <Skeleton className="inline-block h-9 w-20 rounded-control" />
    <Skeleton className="inline-block h-9 w-24 rounded-control" />
  </div>
);

export const SiteLayoutFooter = ({ children }: { children: ReactNode }) => (
  <footer className="border-t border-border bg-surface">
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6 text-sm text-muted-foreground">
      {children}
    </div>
  </footer>
);

export const SiteLayoutFooterLinks = ({
  "aria-label": ariaLabel,
  children,
}: {
  /** Names the footer link list for a screen reader. */
  "aria-label": string;
  children: ReactNode;
}) => (
  <nav
    aria-label={ariaLabel}
    className="flex flex-wrap items-center gap-x-4 gap-y-2"
  >
    {children}
  </nav>
);

export const SiteLayoutFooterLink = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => (
  <Link
    className="transition-colors duration-state ease-state hover:text-foreground"
    href={href}
  >
    {children}
  </Link>
);

export const SiteLayoutFooterContent = ({
  children,
}: {
  children: ReactNode;
}) => (
  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
    {children}
  </div>
);

export const SiteLayoutFooterNote = ({ children }: { children: ReactNode }) => (
  <p>{children}</p>
);

export const SiteLayoutFooterCopyright = ({
  children,
}: {
  children: ReactNode;
}) => <p>{children}</p>;

export const SiteLayoutFooterSkeleton = () => (
  <footer
    aria-busy="true"
    aria-live="polite"
    className="border-t border-border bg-surface"
  >
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-6 md:flex-row md:items-center md:justify-between">
      <Skeleton className="inline-block h-4 w-56 rounded-control" />
      <Skeleton className="inline-block h-4 w-48 rounded-control" />
    </div>
  </footer>
);
