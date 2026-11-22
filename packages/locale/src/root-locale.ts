import { isLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";

/**
 * The locale this request is rendered in, from the `[locale]` root segment.
 *
 * The Next.js compiler replaces `next/root-params` while it bundles the app
 * that imports this module, so a `"use cache"` scope that calls `getLocale`
 * still records `locale` on its cache key. An unsupported segment is
 * `notFound()`. Server Actions and Route Handlers have no root parameters;
 * those callers resolve the locale in the app.
 */
export const getLocale = async (): Promise<Locale> => {
  const value = await rootLocale();

  if (!isLocale(value)) {
    notFound();
  }

  return value;
};
