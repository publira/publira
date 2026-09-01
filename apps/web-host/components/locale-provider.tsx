"use client";

import type { Locale } from "@publira/i18n";
import { createContext, use, useMemo } from "react";
import type { ReactNode } from "react";

interface LocaleContextValue {
  defaultLocale: Locale;
  locale: Locale;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const useLocaleContext = (): LocaleContextValue => {
  const value = use(LocaleContext);
  if (!value) {
    throw new Error(
      "useLocale must be called under <LocaleProvider>: the locale comes from the [locale] root parameter, and there is nothing to guess it from."
    );
  }

  return value;
};

/**
 * Carries the `[locale]` root parameter to Client Components.
 *
 * The obvious implementation reads `useParams()`, and that is what breaks the
 * build: `useParams()` and `usePathname()` call Next.js's dynamic-route-param
 * hook, which aborts a **fallback shell** — the prerender of a route whose own
 * dynamic segment has no value yet, such as `/series/[series_id]` — with a
 * bail-out to client rendering. Every in-app link would then pull the shell of
 * every dynamic route out of the static prerender.
 *
 * The root layout knows the locale without any of that: it is a root parameter,
 * enumerated by `generateStaticParams`, so each shell is prerendered with a
 * literal value. Passing it down through context keeps `<LocaleLink>` and
 * `<LocaleField>` free of dynamic APIs, and the value is identical during SSR
 * and after hydration because it comes from the route tree rather than the
 * browser URL.
 */
export const LocaleProvider = ({
  children,
  defaultLocale,
  locale,
}: {
  children: ReactNode;
  defaultLocale: Locale;
  locale: Locale;
}) => {
  const value = useMemo(
    () => ({ defaultLocale, locale }),
    [defaultLocale, locale]
  );

  return <LocaleContext value={value}>{children}</LocaleContext>;
};

/**
 * Client-side UI locale.
 * Prefer this over prop-drilling in Client Components.
 * Server Components should use `getLocale()` from `#lib/locale` instead.
 */
export const useLocale = (): Locale => useLocaleContext().locale;

/** Tenant default locale, used to construct canonical public URLs. */
export const useTenantDefaultLocale = (): Locale =>
  useLocaleContext().defaultLocale;
