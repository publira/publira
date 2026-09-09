"use client";

import { getLocaleLabel, getLocales, getMessage } from "@publira/i18n";
import { SiteLayoutMobileNavigationLink } from "@publira/layouts";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@publira/ui-components/popover";
import { Skeleton } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { toBarePathname, withLocalePrefix } from "#lib/locale-path";

import { useHostMessages } from "./client-message";
import { useLocale, useTenantDefaultLocale } from "./locale-provider";

/**
 * Header control that swaps the locale segment and keeps the rest of the path.
 *
 * Each locale is a real link, so the choice is shareable and works without
 * JavaScript — the point of putting the locale in the URL instead of a cookie.
 * The target is built from `usePathname()` normalised through
 * {@link toBarePathname}, which erases the difference between the prerendered
 * shell's rewritten pathname and the browser's public one.
 *
 * The query string is deliberately dropped: reading it needs
 * `useSearchParams()`, which adds nothing the reader would miss when switching
 * language — the target is the same page, unfiltered.
 *
 * `usePathname()` aborts the prerender of a route whose own dynamic segment has
 * no value yet, so the site layout renders this inside a `<Suspense>` with
 * {@link LocaleSwitcherSkeleton}: the control streams in and the rest of the
 * shell stays static.
 *
 * The language names come from `getLocaleLabel`, the same registry the cookie
 * consoles read. They are autonyms — a language is offered in its own language
 * — so they are identical in both directions and belong to the registry rather
 * than to a per-locale catalog.
 */
/** Same footprint as the rendered control, so the header does not shift. */
export const LocaleSwitcherSkeleton = () => (
  <div
    aria-hidden="true"
    className="h-9 w-24 animate-pulse rounded-control bg-muted"
  />
);

export const LocaleSwitcher = () => {
  const currentLocale = useLocale();
  const defaultLocale = useTenantDefaultLocale();
  const messages = useHostMessages();
  const barePathname = toBarePathname(usePathname());

  const label = getMessage(messages, "host.nav.locale_switcher");

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${label}: ${getLocaleLabel(currentLocale)}`}
        className="inline-flex h-9 max-w-28 items-center rounded-control border border-input bg-card px-3 text-sm font-medium text-foreground transition-colors duration-state ease-state hover:bg-muted data-popup-open:bg-muted"
      >
        <span className="truncate">{getLocaleLabel(currentLocale)}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48" sideOffset={8}>
        <PopoverTitle className="px-2 py-1.5 text-sm font-medium text-foreground">
          {label}
        </PopoverTitle>
        <div className="grid gap-0.5">
          {getLocales().map((locale) => {
            const current = locale === currentLocale;

            return (
              <Link
                aria-current={current ? "true" : undefined}
                className={
                  current
                    ? "rounded-control bg-muted px-3 py-2 text-sm font-medium text-foreground"
                    : "rounded-control px-3 py-2 text-sm text-muted-foreground transition-colors duration-state ease-state hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-hidden"
                }
                href={withLocalePrefix(locale, defaultLocale, barePathname)}
                hrefLang={locale}
                key={locale}
                lang={locale}
              >
                {getLocaleLabel(locale)}
              </Link>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};

/** Same footprint as the rendered list, so the drawer does not shift. */
export const LocaleSwitcherLinksSkeleton = () => (
  <div aria-hidden="true" className="grid gap-1">
    <Skeleton className="h-9 rounded-control" />
    <Skeleton className="h-9 rounded-control" />
    <Skeleton className="h-9 rounded-control" />
  </div>
);

/**
 * The same choice {@link LocaleSwitcher} offers, laid out as a list.
 *
 * The drawer the phone header opens is already a panel, so the popover the
 * band uses would be a second one inside it. The options are rows of the
 * drawer instead, and each closes it on the way to the other language.
 */
export const LocaleSwitcherLinks = () => {
  const currentLocale = useLocale();
  const defaultLocale = useTenantDefaultLocale();
  const barePathname = toBarePathname(usePathname());

  return getLocales().map((locale) => (
    <SiteLayoutMobileNavigationLink
      current={locale === currentLocale}
      href={withLocalePrefix(locale, defaultLocale, barePathname)}
      hrefLang={locale}
      key={locale}
      lang={locale}
    >
      {getLocaleLabel(locale)}
    </SiteLayoutMobileNavigationLink>
  ));
};
