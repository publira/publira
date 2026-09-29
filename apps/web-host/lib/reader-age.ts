import { provenAgeRating } from "./age-rating";
import type { RestrictedAgeRating } from "./age-rating";
import { getMe } from "./auth";
import { getTenantDisplayTimeZone } from "./tenant";

/**
 * The highest rating this reader's stored birth date carries, counted on the
 * tenant's calendar day. A failed read answers "nothing is proven", which
 * leaves the interstitial standing rather than taking a page down over it.
 */
export const getReaderProvenAgeRating = async (
  tenantId: string
): Promise<RestrictedAgeRating | undefined> => {
  try {
    const [me, timeZone] = await Promise.all([
      getMe(tenantId),
      getTenantDisplayTimeZone(tenantId),
    ]);
    const birthDate = me?.birthDate.trim();
    if (!birthDate) {
      return undefined;
    }

    return provenAgeRating(birthDate, Temporal.Now.plainDateISO(timeZone));
  } catch {
    return undefined;
  }
};

/**
 * Whether this reader has a birth date on file, which is what separates "add
 * yours" from "not available for your age" on the age gate. A failed read
 * answers `false`, and that gate points at the settings screen either way.
 */
export const readerHasBirthDate = async (
  tenantId: string
): Promise<boolean> => {
  try {
    const me = await getMe(tenantId);
    return Boolean(me?.birthDate.trim());
  } catch {
    return false;
  }
};
