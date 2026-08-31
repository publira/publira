/**
 * The locale a screen opens on when there is no stored preference to read.
 *
 * Initial setup and tenant creation decide a default language before one has
 * been saved, so the request's `Accept-Language` is the only signal about the
 * person in front of the screen. It seeds the first render and the selector's
 * initial option; the value that gets saved is whatever the operator then picks
 * from the supported locales, validated against that list in the Server Action.
 *
 * `headers()` is a request-time read, so callers sit inside a `<Suspense>`
 * boundary and never inside a `"use cache"` scope.
 */

import { negotiateInitialLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { headers } from "next/headers";

export const getInitialLocaleCandidate = async (): Promise<Locale> => {
  const requestHeaders = await headers();

  return negotiateInitialLocale(requestHeaders.get("accept-language"));
};
