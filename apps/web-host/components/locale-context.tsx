"use client";

import type { Locale } from "@publira/i18n";
import { createContext, use } from "react";
import type { ReactNode } from "react";

/**
 * The `[locale]` root parameter. Not `useParams()`: that bails a fallback shell
 * such as `/series/[series_id]` out to client rendering.
 */
const LocaleContext = createContext<Promise<Locale> | null>(null);

/**
 * The tenant's stored default locale, which decides whether a link needs a
 * prefix. It resolves to `null` while the tenant read is unavailable, and
 * `withLocalePrefix` then keeps the prefix.
 */
const TenantDefaultLocaleContext = createContext<Promise<Locale | null> | null>(
  null
);

export const LocaleContextProvider = ({
  children,
  locale,
}: {
  children: ReactNode;
  locale: Promise<Locale>;
}) => <LocaleContext value={locale}>{children}</LocaleContext>;

export const TenantDefaultLocaleContextProvider = ({
  children,
  defaultLocale,
}: {
  children: ReactNode;
  defaultLocale: Promise<Locale | null>;
}) => (
  <TenantDefaultLocaleContext value={defaultLocale}>
    {children}
  </TenantDefaultLocaleContext>
);

/**
 * The request's locale in a Client Component; Server Components use
 * `getLocale()`.
 */
export const useLocale = (): Locale => {
  const locale = use(LocaleContext);
  if (!locale) {
    throw new Error(
      "useLocale must be called under <LocaleProvider>: the locale comes from the [locale] root parameter, and there is nothing to guess it from."
    );
  }

  return use(locale);
};

/**
 * The tenant's stored default locale, or `null` while it is unavailable. This
 * suspends, so the caller needs a `<Suspense>` above it — usually the one its
 * section already has.
 */
export const useTenantDefaultLocale = (): Locale | null => {
  const defaultLocale = use(TenantDefaultLocaleContext);
  if (!defaultLocale) {
    throw new Error(
      "useTenantDefaultLocale must be called under <TenantDefaultLocaleProvider>: the tenant's stored default comes from GetTenant, and there is nothing to guess it from."
    );
  }

  return use(defaultLocale);
};
