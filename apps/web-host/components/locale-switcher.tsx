"use client";

import { getLocales, getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { toBarePathname, withLocalePrefix } from "#lib/locale-path";

import { useHostMessages } from "./client-message";
import { useLocale } from "./locale-provider";

/**
 * Autonyms. A language is offered in its own language, so these stay the same
 * whichever locale the page is rendered in and never enter the message
 * catalog.
 */
const LOCALE_LABELS = {
  en: "English",
  ja: "日本語",
} as const satisfies Record<Locale, string>;

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
 */
/** Same footprint as the rendered control, so the header does not shift. */
export const LocaleSwitcherSkeleton = () => (
  <div aria-hidden="true" className="h-6 w-24 animate-pulse rounded bg-muted" />
);

export const LocaleSwitcher = () => {
  const currentLocale = useLocale();
  const messages = useHostMessages();
  const barePathname = toBarePathname(usePathname());

  return (
    <nav
      aria-label={getMessage(messages, "host.nav.locale_switcher")}
      className="flex items-center gap-1 text-xs"
    >
      {getLocales().map((locale) => {
        const current = locale === currentLocale;

        return (
          <Link
            aria-current={current ? "true" : undefined}
            className={
              current
                ? "rounded px-1.5 py-1 font-medium text-foreground"
                : "rounded px-1.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
            }
            href={withLocalePrefix(locale, barePathname)}
            hrefLang={locale}
            key={locale}
            lang={locale}
          >
            {LOCALE_LABELS[locale]}
          </Link>
        );
      })}
    </nav>
  );
};
