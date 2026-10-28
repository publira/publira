"use client";

import { getLocaleLabel } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { LanguageIcon } from "@publira/icons/language-icon";
import * as SiteLayout from "@publira/layouts/site-layout";
import { buttonVariants } from "@publira/ui-components/button";
import * as Popover from "@publira/ui-components/popover";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
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
 * `LocaleSwitcher.Skeleton`: the control streams in and the rest of the
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
const LocaleSwitcherSkeleton = () => (
  <Skeleton className="size-9 pointer-coarse:size-11" />
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

const LocaleSwitcher = () => {
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
    <Popover.Root>
      <Popover.Trigger
        aria-label={label}
        className={cn(
          buttonVariants({ size: "icon", variant: "ghost" }),
          "data-popup-open:bg-muted"
        )}
      >
        <LanguageIcon aria-hidden="true" className="size-5" />
      </Popover.Trigger>
      <Popover.Content align="end" className="w-48" sideOffset={8}>
        <Popover.Title className="px-2 py-1.5 text-sm font-medium text-foreground">
          {label}
        </Popover.Title>
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
      </Popover.Content>
    </Popover.Root>
  );
};

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
    <SiteLayout.MobileNavigationLink
      current={locale === currentLocale}
      href={withLocalePrefix(locale, defaultLocale, barePathname)}
      hrefLang={locale}
      key={locale}
      lang={locale}
    >
      {getLocaleLabel(locale)}
    </SiteLayout.MobileNavigationLink>
  ));
};

/**
 * Stands in for the row `LocaleSwitcher.Disclosure` draws, at the height
 * of its trigger, while the tenant read is pending: the shell cannot know
 * whether the tenant offers more than one locale. It is not a button, so
 * nothing reaches a control that has no name yet and may never appear.
 */
const LocaleSwitcherDisclosureSkeleton = () => (
  <div aria-hidden="true" className="px-3 py-2 text-sm pointer-coarse:py-3">
    <SkeletonLine className="h-4 w-16" />
  </div>
);

/**
 * The same choice {@link LocaleSwitcher} offers, laid out as rows.
 *
 * The drawer the phone header opens is already a panel, so the popover the
 * band uses would be a second one inside it. The options collapse into the
 * drawer instead, behind the one row
 * `SiteLayout.MobileNavigationDisclosureTrigger` draws, and each closes the
 * drawer on the way to the other language. The row goes with the options: a
 * tenant that offers one locale gets neither, as the band gets no button.
 */
const LocaleSwitcherDisclosure = () => {
  const currentLocale = useLocale();
  const locales = useSwitchableLocales(currentLocale);

  if (!offersChoice(locales)) {
    return null;
  }

  return (
    <SiteLayout.MobileNavigationDisclosure>
      <SiteLayout.MobileNavigationDisclosureTrigger>
        <ClientMessage message="storefront.nav.locale_switcher" />
      </SiteLayout.MobileNavigationDisclosureTrigger>
      <SiteLayout.MobileNavigationDisclosurePanel>
        <LocaleSwitcherLinks currentLocale={currentLocale} locales={locales} />
      </SiteLayout.MobileNavigationDisclosurePanel>
    </SiteLayout.MobileNavigationDisclosure>
  );
};

export {
  LocaleSwitcher as Root,
  LocaleSwitcherDisclosure as Disclosure,
  LocaleSwitcherDisclosureSkeleton as DisclosureSkeleton,
  LocaleSwitcherSkeleton as Skeleton,
};
