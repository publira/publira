import type { Locale } from "@publira/i18n";

import { resolveAccessToken } from "#lib/api-client";
import { getEpisodeViewer } from "#lib/catalog";
import { readerHasBirthDate } from "#lib/reader-age";

/** What the age gate needs to say why this reader is stopped. */
export interface ReaderAgeRestriction {
  hasBirthDate: boolean;
  signedIn: boolean;
}

/**
 * Whether the tenant's age rule stops the reader in front of the page, asked
 * only once the anonymous read has answered `age_restricted`. A guest is
 * stopped by definition; a signed-in reader is asked with their own session,
 * through the same private read the body makes. `undefined` means the rule
 * does not stop them, or that it could not be told.
 */
export const getReaderAgeRestriction = async ({
  checkoutSessionId,
  episodePublicId,
  locale,
  seriesPublicId,
  tenantId,
}: {
  checkoutSessionId: string;
  episodePublicId: string;
  locale: Locale;
  seriesPublicId: string;
  tenantId: string;
}): Promise<ReaderAgeRestriction | undefined> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return { hasBirthDate: false, signedIn: false };
  }

  const viewer = await getEpisodeViewer(
    tenantId,
    seriesPublicId,
    episodePublicId,
    sessionId,
    locale,
    checkoutSessionId
  );
  if (!viewer.ok || viewer.value?.access !== "age_restricted") {
    return undefined;
  }

  return { hasBirthDate: await readerHasBirthDate(tenantId), signedIn: true };
};
