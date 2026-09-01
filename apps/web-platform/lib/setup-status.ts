import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import { apiClient } from "./api-client";

/**
 * What `CheckSetupStatus` said about the console's language.
 *
 * `saved: null` is a platform that has saved nothing yet, and `ok: false` is a
 * read that got no answer. They are different states — the first means the
 * console has no language to prefer, the second means it could not ask — so
 * this is not a plain `Locale | null`.
 */
type SetupLocaleRead = { ok: false } | { ok: true; saved: Locale | null };

/**
 * `CheckSetupStatus` is the one platform read a visitor with no session can
 * make, and `proxy.ts` already makes it on every request, so the login screen
 * learns the console's language without a round trip of its own.
 *
 * Kept out of `lib/setup.ts` because that module words its failures from the
 * catalog, which would make resolving the locale depend on already having one.
 */
const readSetupLocale = async (): Promise<SetupLocaleRead> => {
  "use cache: private";

  try {
    const response = await apiClient.setup.checkSetupStatus({});
    return {
      ok: true,
      saved: parseLocale(response.defaultLocale.trim()) ?? null,
    };
  } catch {
    dropFailedCacheEntry();
    return { ok: false };
  }
};

/**
 * The last saved locale the platform API confirmed, for this server process.
 * `undefined` while it has never confirmed one.
 */
let lastConfirmedDefaultLocale: Locale | undefined;

/**
 * The platform's saved default locale, or `null` when there is none to have.
 *
 * An outage does not change what the platform saved, so it must not change the
 * language the console renders in: the operator is reading an error screen, and
 * having it arrive in another language would make the outage look like a
 * setting they had changed. A read that gets no answer therefore reports the
 * last locale the API did confirm — the same shape {@link resolveSetupCompleted}
 * uses to keep routing through an outage, and for the same reason.
 *
 * `null` is only for a platform that has genuinely saved nothing: before setup,
 * or a process that has never had an answer at all.
 */
export const resolveSetupDefaultLocale = async (): Promise<Locale | null> => {
  const read = await readSetupLocale();
  if (read.ok) {
    lastConfirmedDefaultLocale = read.saved ?? undefined;
    return read.saved;
  }

  return lastConfirmedDefaultLocale ?? null;
};
