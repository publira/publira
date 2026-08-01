import { Skeleton } from "@publira/ui-components/skeleton";
import { Suspense } from "react";
import type { ReactNode } from "react";

export interface LayoutLinkItem {
  href: string;
  label: string;
}

export interface LayoutActionItem extends LayoutLinkItem {
  className?: string;
}

export const defaultSiteLayoutNavItems: LayoutLinkItem[] = [
  { href: "/authors", label: "Authors" },
  { href: "/series", label: "Series" },
];

const normalizeLayoutText = (
  value: string | undefined | null
): string | undefined => {
  const normalized = value?.trim();
  return normalized || undefined;
};

const SiteLayoutBrandText = async ({
  href,
  label,
}: {
  href: string;
  label?: string | Promise<string | undefined>;
}) => {
  const resolvedAppLabel = await label;
  const normalizedLabel = normalizeLayoutText(resolvedAppLabel);

  if (!normalizedLabel) {
    return null;
  }

  // oxlint-disable-next-line nextjs/no-html-link-for-pages
  return (
    <a className="font-serif text-lg font-semibold" href={href}>
      {normalizedLabel}
    </a>
  );
};

export const SiteLayoutBrandSkeleton = () => (
  <Skeleton className="inline-block h-5 w-24 rounded" />
);

export const SiteLayoutFooterSkeleton = () => (
  <footer
    aria-busy="true"
    aria-live="polite"
    className="border-t border-border/70 bg-surface"
  >
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-6 md:flex-row md:items-center md:justify-between">
      <Skeleton className="inline-block h-4 w-56 rounded" />
      <Skeleton className="inline-block h-4 w-48 rounded" />
    </div>
  </footer>
);

const SiteLayoutFooterContentInner = async ({
  copyrightText,
  footerNote,
}: {
  copyrightText?: string | Promise<string | undefined>;
  footerNote?: string | Promise<string | undefined>;
}) => {
  const [resolvedFooterNote, resolvedCopyrightText] = await Promise.all([
    footerNote,
    copyrightText,
  ]);

  const normalizedFooterNote = normalizeLayoutText(resolvedFooterNote);
  const normalizedCopyrightText = normalizeLayoutText(resolvedCopyrightText);

  if (!normalizedFooterNote && !normalizedCopyrightText) {
    return null;
  }

  return (
    <footer className="border-t border-border/70 bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-6 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
        {normalizedFooterNote && <p>{normalizedFooterNote}</p>}
        {normalizedCopyrightText && <p>{normalizedCopyrightText}</p>}
      </div>
    </footer>
  );
};

const SiteLayoutAsyncContent = async ({
  content,
}: {
  content: ReactNode | Promise<ReactNode>;
}) => await content;

export const SiteLayout = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-dvh flex-col bg-background text-foreground">
    {children}
  </div>
);

export const SiteLayoutHeader = ({ children }: { children: ReactNode }) => (
  <header className="border-b border-border/70 bg-card/70 backdrop-blur">
    <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4">
      {children}
    </div>
  </header>
);

export const SiteLayoutBrand = ({
  href = "/",
  label,
}: {
  href?: string;
  label?: string | Promise<string | undefined>;
}) => (
  <Suspense fallback={<SiteLayoutBrandSkeleton />}>
    <SiteLayoutBrandText href={href} label={label} />
  </Suspense>
);

export const SiteLayoutNav = ({
  items = defaultSiteLayoutNavItems,
}: {
  items?: LayoutLinkItem[];
}) => (
  <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
    {items.map((item) => (
      <a
        className="transition-colors hover:text-foreground"
        href={item.href}
        key={item.href}
      >
        {item.label}
      </a>
    ))}
  </nav>
);

export const SiteLayoutMain = ({ children }: { children: ReactNode }) => (
  <main className="flex-1">{children}</main>
);

export const SiteLayoutHeaderActionsSkeleton = () => (
  <div aria-busy="true" aria-live="polite" className="flex items-center gap-2">
    <Skeleton className="inline-block h-8 w-20 rounded-md" />
    <Skeleton className="inline-block h-8 w-24 rounded-md" />
  </div>
);

export const SiteLayoutHeaderActions = ({
  content,
}: {
  content: ReactNode | Promise<ReactNode>;
}) => (
  <Suspense fallback={<SiteLayoutHeaderActionsSkeleton />}>
    <SiteLayoutAsyncContent content={content} />
  </Suspense>
);

export const SiteLayoutFooter = ({
  copyrightText,
  footerNote,
}: {
  copyrightText?: string | Promise<string | undefined>;
  footerNote?: string | Promise<string | undefined>;
}) => (
  <Suspense fallback={<SiteLayoutFooterSkeleton />}>
    <SiteLayoutFooterContentInner
      copyrightText={copyrightText}
      footerNote={footerNote}
    />
  </Suspense>
);
