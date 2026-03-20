import type { ReactNode } from "react";

export interface LayoutLinkItem {
  href: string;
  label: string;
}

export interface LayoutLinkComponentProps {
  children: ReactNode;
  className?: string;
  href: string;
}

export interface LayoutActionItem extends LayoutLinkItem {
  className?: string;
}

export interface SiteLayoutProps {
  children: ReactNode;
  appLabel?: string;
  footerNote?: string;
  linkComponent?: React.ComponentType<LayoutLinkComponentProps>;
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

const DefaultLink = ({
  children,
  className,
  href,
}: LayoutLinkComponentProps) => (
  <a className={className} href={href}>
    {children}
  </a>
);

export const SiteLayout = ({
  appLabel = "Publira",
  children,
  footerNote = defaultFooterNote,
  linkComponent: LinkComponent = DefaultLink,
  navItems = defaultNavItems,
  primaryAction = defaultPrimaryAction,
  secondaryAction = defaultSecondaryAction,
}: SiteLayoutProps) => (
  <div className="flex min-h-dvh flex-col bg-background text-foreground">
    <header className="border-b border-border/70 bg-card/70 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <LinkComponent
          className="font-['Noto_Serif_JP',serif] text-lg font-semibold"
          href="/"
        >
          {appLabel}
        </LinkComponent>

        <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
          {navItems.map((item) => (
            <LinkComponent
              className="transition-colors hover:text-foreground"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </LinkComponent>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <LinkComponent
            className={
              secondaryAction.className ??
              "rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
            }
            href={secondaryAction.href}
          >
            {secondaryAction.label}
          </LinkComponent>
          <LinkComponent
            className={
              primaryAction.className ??
              "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90"
            }
            href={primaryAction.href}
          >
            {primaryAction.label}
          </LinkComponent>
        </div>
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
