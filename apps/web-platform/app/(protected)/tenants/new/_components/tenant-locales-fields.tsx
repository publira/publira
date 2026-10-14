import { getInitialLocaleCandidate } from "#lib/initial-locale";

import { TenantLocalesPicker } from "./tenant-locales-picker";

/**
 * The new tenant's default language and the languages its site offers.
 *
 * A tenant that does not exist yet has nothing stored to open on, so the
 * operator's `Accept-Language` seeds the default the same way it does on
 * `/setup`. It is only a starting point: the values sent to the API are
 * whatever is submitted, and the Server Action checks them against the
 * supported locales.
 */
export const TenantLocalesFields = async () => (
  <TenantLocalesPicker
    initialDefaultLocale={await getInitialLocaleCandidate()}
  />
);
