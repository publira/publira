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

/**
 * The locales the tenant's site offers, which decide what the language
 * switcher lists. It resolves to `null` while the tenant read is unavailable.
 */
const TenantSupportedLocalesContext = createContext<Promise<
  readonly Locale[] | null
> | null>(null);

export const TenantLocalesContextProvider = ({
  children,
  defaultLocale,
  supportedLocales,
}: {
  children: ReactNode;
  defaultLocale: Promise<Locale | null>;
  supportedLocales: Promise<readonly Locale[] | null>;
}) => (
  <TenantDefaultLocaleContext value={defaultLocale}>
    <TenantSupportedLocalesContext value={supportedLocales}>
      {children}
    </TenantSupportedLocalesContext>
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
      "useTenantDefaultLocale must be called under <TenantLocalesProvider>: the tenant's stored default comes from GetTenant, and there is nothing to guess it from."
    );
  }

  return use(defaultLocale);
};

/**
 * The locales the tenant's site offers, or `null` while they are unavailable.
 * This suspends, the way {@link useTenantDefaultLocale} does.
 */
export const useTenantSupportedLocales = (): readonly Locale[] | null => {
  const supportedLocales = use(TenantSupportedLocalesContext);
  if (!supportedLocales) {
    throw new Error(
      "useTenantSupportedLocales must be called under <TenantLocalesProvider>: the locales the tenant offers come from GetTenant, and there is nothing to guess them from."
    );
  }

  return use(supportedLocales);
};
