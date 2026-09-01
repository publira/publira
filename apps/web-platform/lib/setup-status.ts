import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import { apiClient } from "./api-client";

/**
 * The saved platform default locale, or `null` when the platform API reported
 * none.
 *
 * `CheckSetupStatus` is the one platform read a visitor with no session can
 * make, and `proxy.ts` already makes it on every request, so the login screen
 * learns the console's language without a round trip of its own. `null` covers
 * both "the platform is not set up yet", where nothing has been saved, and a
 * read that failed; `getPlatformDisplayLocale` is where those two part company.
 *
 * Kept out of `lib/setup.ts` because that module words its failures from the
 * catalog, which would make resolving the locale depend on already having one.
 */
export const readSetupDefaultLocale = async (): Promise<Locale | null> => {
  "use cache: private";

  try {
    const response = await apiClient.setup.checkSetupStatus({});
    return parseLocale(response.defaultLocale.trim()) ?? null;
  } catch {
    dropFailedCacheEntry();
    return null;
  }
};
