"use client";

import type { Locale } from "@publira/i18n";
import { createContext, use } from "react";
import type { ReactNode } from "react";

const LocaleContext = createContext<Locale | null>(null);
const TenantDefaultLocaleContext = createContext<Locale | null>(null);

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
 * The `(site)` and `(auth)` layouts know the locale without any of that: it is
 * a root parameter, enumerated by `generateStaticParams`, so each shell is
 * prerendered with a literal value. Passing it down through context keeps
 * `<LocaleLink>` and `<LocaleField>` free of dynamic APIs, and the value is
 * identical during SSR and after hydration because it comes from the route
 * tree rather than the browser URL.
 *
 * The root layout is not where this is seeded, even though the locale is
 * cheaper to resolve there than anything else: a root layout reads nothing, so
 * the two group layouts below it own the read (`app/[tenant_id]/[locale]/
 * error.tsx` seeds its own, from the browser, because a failure in those
 * layouts is exactly what brings it up).
 */
export const LocaleProvider = ({
  children,
  locale,
}: {
  children: ReactNode;
  locale: Locale;
}) => <LocaleContext value={locale}>{children}</LocaleContext>;

/**
 * Carries the tenant's stored default locale, which is what tells a link
 * whether its href needs a prefix at all (`withLocalePrefix`).
 *
 * It is a separate provider from {@link LocaleProvider} because it is a
 * separate kind of value: the request's locale is a root parameter and a
 * network read cannot fail to produce it, while this one comes from
 * `GetTenant` and can. Splitting them is what lets the error boundary above
 * the group layouts render its own copy without pretending to know a default
 * the read that failed was going to supply.
 */
export const TenantDefaultLocaleProvider = ({
  children,
  defaultLocale,
}: {
  children: ReactNode;
  defaultLocale: Locale;
}) => (
  <TenantDefaultLocaleContext value={defaultLocale}>
    {children}
  </TenantDefaultLocaleContext>
);

/**
 * Client-side UI locale.
 * Prefer this over prop-drilling in Client Components.
 * Server Components should use `getLocale()` from `#lib/locale` instead.
 */
export const useLocale = (): Locale => {
  const locale = use(LocaleContext);
  if (!locale) {
    throw new Error(
      "useLocale must be called under <LocaleProvider>: the locale comes from the [locale] root parameter, and there is nothing to guess it from."
    );
  }

  return locale;
};

/** Tenant default locale, used to construct canonical public URLs. */
export const useTenantDefaultLocale = (): Locale => {
  const defaultLocale = use(TenantDefaultLocaleContext);
  if (!defaultLocale) {
    throw new Error(
      "useTenantDefaultLocale must be called under <TenantDefaultLocaleProvider>: the tenant's stored default comes from GetTenant, and there is nothing to guess it from."
    );
  }

  return defaultLocale;
};
