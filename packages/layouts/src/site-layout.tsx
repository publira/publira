import type { ReactNode } from "react";

import { SiteLayoutActions } from "./site-layout-actions";

export interface LayoutLinkItem {
  href: string;
  label: string;
}

export interface LayoutActionItem extends LayoutLinkItem {
  className?: string;
}

export interface SiteLayoutProps {
  children: ReactNode;
  appLabel?: string;
  footerNote?: string;
  navItems?: LayoutLinkItem[];
  primaryAction?: LayoutActionItem;
  secondaryAction?: LayoutActionItem;
}

const defaultNavItems: LayoutLinkItem[] = [
  { href: "/", label: "Home" },
  { href: "/authors", label: "Authors" },
  { href: "/series", label: "Series" },
];

const defaultFooterNote =
  "Crafted for calm reading and sustainable publishing.";

const defaultPrimaryAction: LayoutActionItem = {
  href: "/signup",
  label: "Start",
};

const defaultSecondaryAction: LayoutActionItem = {
  href: "/login",
  label: "Sign in",
};

export const SiteLayout = ({
  appLabel = "Publira",
  children,
  footerNote = defaultFooterNote,
  navItems = defaultNavItems,
  primaryAction = defaultPrimaryAction,
  secondaryAction = defaultSecondaryAction,
}: SiteLayoutProps) => (
  <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <header className="border-b border-border/70 bg-card/70 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
        {/* oxlint-disable-next-line nextjs/no-html-link-for-pages */}
        <a className="font-serif text-lg font-semibold" href="/">
          {appLabel}
        </a>

        <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
          {navItems.map((item) => (
            <a
              className="transition-colors hover:text-foreground"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <SiteLayoutActions
          primaryAction={primaryAction}
          secondaryAction={secondaryAction}
        />
      </div>
    </header>

    <main className="flex-1">{children}</main>

    <footer className="border-t border-border/70 bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-6 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
        <p>{footerNote}</p>
        <p>Copyright &copy; 2026 Publira</p>
      </div>
    </footer>
  </div>
);
