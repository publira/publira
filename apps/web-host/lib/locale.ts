import { isLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { notFound } from "next/navigation";
import { locale } from "next/root-params";

import { withLocalePrefix } from "./locale-path";

/**
 * Resolve the current request's UI locale from the `[locale]` root segment.
 * Prefer this over prop-drilling `params.locale` in Server Components.
 *
 * The public site keeps the locale in the URL rather than in a cookie, so it
 * is part of the cache key of anything rendered under it: `"use cache"` scopes
 * may call this directly, the way `getTenantId()` is called.
 *
 * An unsupported segment is a 404 rather than a silent fall back to `ja`.
 * `proxy.ts` redirects a locale-less path to the default locale, so the only
 * way to arrive here with something else is a URL that names a locale this
 * site does not serve — and answering it with Japanese content under a
 * foreign prefix would hand crawlers a duplicate of every page.
 *
 * Note: `next/root-params` is not available in Server Actions or Route
 * Handlers. Actions take the locale as a bound argument or a form field; see
 * `lib/locale-form.ts`.
 */
export const getLocale = async (): Promise<Locale> => {
  const value = await locale();
  if (typeof value !== "string" || !isLocale(value)) {
    notFound();
  }
  return value;
};

/**
 * An app-internal path under the current locale: `/series` → `/ja/series`.
 *
 * Server Components that hand a bare href to a shared layout component use
 * this; JSX links use `<LocaleLink>`, which applies the same prefix on its own.
 */
export const localePath = async (href: string): Promise<string> =>
  withLocalePrefix(await getLocale(), href);
