import { getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

/**
 * One `generateStaticParams` entry per locale.
 *
 * `extra` is the other root segments the layout has to name. `web-admin` and
 * `web-storefront` pass the tenant placeholder; `web-platform` passes nothing.
 * The locale key is written after `extra`, so a caller cannot replace it.
 */
export const generateLocaleStaticParams = (
  extra?: Readonly<Record<string, string>>
): { locale: Locale; [key: string]: string }[] =>
  getLocales().map((locale) => ({
    ...extra,
    locale,
  }));
