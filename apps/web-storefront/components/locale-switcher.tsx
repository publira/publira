"use client";

import { getLocaleLabel, getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { LanguageIcon } from "@publira/icons/language-icon";
import {
  SiteLayoutMobileNavigationDisclosure,
  SiteLayoutMobileNavigationDisclosurePanel,
  SiteLayoutMobileNavigationDisclosureTrigger,
  SiteLayoutMobileNavigationLink,
} from "@publira/layouts";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@publira/ui-components/popover";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { toBarePathname, withLocalePrefix } from "#lib/locale-path";

import { ClientMessage, useClientMessages } from "./client-message";
import {
  useLocale,
  useTenantDefaultLocale,
  useTenantSupportedLocales,
} from "./locale-context";

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
 * It lists the locales the tenant offers, the ones `proxy.ts` serves under a
 * prefix, and renders nothing for a tenant that offers one: a list holding only
 * the page being read switches to nothing, and the button alone would promise
 * languages the site does not have. The language names come from
 * `getLocaleLabel`, the same registry the cookie consoles read. They are
 * autonyms — a language is offered in its own language — so they are identical
 * in both directions and belong to the registry rather than to a per-locale
 * catalog.
 */
/**
 * Same footprint as the rendered control, so the header does not shift. The
 * shell is shared by every tenant, so a tenant that offers one locale sees this
 * give way to nothing.
 */
export const LocaleSwitcherSkeleton = () => (
  <div
    aria-hidden="true"
    className="size-9 animate-pulse rounded-control bg-muted pointer-coarse:size-11"
  />
);

/**
 * The locales the switcher lists. While the tenant read is unavailable it is
 * the one being read: `proxy.ts` served it, so the tenant offers it, and no
 * other locale is known to be one the tenant has not switched off. That one
 * entry hides the switcher too, and the proxy keeps serving whichever locale
 * the URL names.
 */
const useSwitchableLocales = (currentLocale: Locale): readonly Locale[] =>
  useTenantSupportedLocales() ?? [currentLocale];

/** Whether the locales leave a reader anything to switch to. */
const offersChoice = (locales: readonly Locale[]) => locales.length > 1;

export const LocaleSwitcher = () => {
  const currentLocale = useLocale();
  const defaultLocale = useTenantDefaultLocale();
  const locales = useSwitchableLocales(currentLocale);
  const t = useClientMessages();
  const pathname = usePathname();
  const barePathname = toBarePathname(pathname);

  const label = t("storefront.nav.locale_switcher");

  if (!offersChoice(locales)) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        className="inline-flex size-9 items-center justify-center rounded-control border border-input bg-card text-foreground transition-colors duration-state ease-state hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-popup-open:bg-muted pointer-coarse:size-11"
      >
        <LanguageIcon aria-hidden="true" className="size-5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48" sideOffset={8}>
        <PopoverTitle className="px-2 py-1.5 text-sm font-medium text-foreground">
          {label}
        </PopoverTitle>
        <div className="grid gap-0.5">
          {locales.map((locale) => {
            const current = locale === currentLocale;

            return (
              <Link
                aria-current={current ? "true" : undefined}
                className={
                  current
                    ? "rounded-control bg-muted px-3 py-2 text-sm font-medium text-foreground pointer-coarse:py-3"
                    : "rounded-control px-3 py-2 text-sm text-muted-foreground transition-colors duration-state ease-state hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-hidden pointer-coarse:py-3"
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

/**
 * Stands in for the rendered list while the copy arrives. The shell is shared
 * by every tenant, so it cannot know how many locales a tenant offers; it draws
 * one row per registry entry, the most the list can draw, so a locale added to
 * the registry cannot leave the panel too short for it.
 */
export const LocaleSwitcherLinksSkeleton = () => (
  <div aria-hidden="true" className="grid gap-1">
    {getLocales().map((locale) => (
      <Skeleton className="h-9 rounded-control" key={locale} />
    ))}
  </div>
);

const LocaleSwitcherLinks = ({
  currentLocale,
  locales,
}: {
  currentLocale: Locale;
  locales: readonly Locale[];
}) => {
  const defaultLocale = useTenantDefaultLocale();
  const pathname = usePathname();
  const barePathname = toBarePathname(pathname);

  return locales.map((locale) => (
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

/**
 * The disclosure {@link LocaleSwitcherDisclosure} draws, its panel holding
 * {@link LocaleSwitcherLinksSkeleton}: the drawer keeps the row while the
 * tenant read is pending, since the shell cannot know whether the tenant offers
 * more than one locale.
 */
export const LocaleSwitcherDisclosureSkeleton = () => (
  <SiteLayoutMobileNavigationDisclosure>
    <SiteLayoutMobileNavigationDisclosureTrigger>
      <SkeletonLine className="h-4 w-16" />
    </SiteLayoutMobileNavigationDisclosureTrigger>
    <SiteLayoutMobileNavigationDisclosurePanel>
      <LocaleSwitcherLinksSkeleton />
    </SiteLayoutMobileNavigationDisclosurePanel>
  </SiteLayoutMobileNavigationDisclosure>
);

/**
 * The same choice {@link LocaleSwitcher} offers, laid out as rows.
 *
 * The drawer the phone header opens is already a panel, so the popover the
 * band uses would be a second one inside it. The options collapse into the
 * drawer instead, behind the one row
 * `SiteLayoutMobileNavigationDisclosureTrigger` draws, and each closes the
 * drawer on the way to the other language. The row goes with the options: a
 * tenant that offers one locale gets neither, as the band gets no button.
 */
export const LocaleSwitcherDisclosure = () => {
  const currentLocale = useLocale();
  const locales = useSwitchableLocales(currentLocale);

  if (!offersChoice(locales)) {
    return null;
  }

  return (
    <SiteLayoutMobileNavigationDisclosure>
      <SiteLayoutMobileNavigationDisclosureTrigger>
        <ClientMessage message="storefront.nav.locale_switcher" />
      </SiteLayoutMobileNavigationDisclosureTrigger>
      <SiteLayoutMobileNavigationDisclosurePanel>
        <LocaleSwitcherLinks currentLocale={currentLocale} locales={locales} />
      </SiteLayoutMobileNavigationDisclosurePanel>
    </SiteLayoutMobileNavigationDisclosure>
  );
};
