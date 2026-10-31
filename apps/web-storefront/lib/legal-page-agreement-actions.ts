"use server";

import type { Locale } from "@publira/i18n";

import { resolveAccessToken } from "./api-client";
import { readLegalPageAgreementExemptPaths } from "./legal-page-agreements";

/**
 * Whether the signed-in reader owes an agreement now, for the site's gate to
 * ask again after a client-side navigation, which keeps the layout the gate
 * was rendered in. `tenantId` and `locale` are bound by the layout, since
 * `next/root-params` is not available in Server Actions.
 */
export const checkLegalPageAgreementAction = async (
  tenantId: string,
  locale: Locale
): Promise<string[] | null> => {
  const accessToken = await resolveAccessToken();

  if (!accessToken) {
    return null;
  }

  return readLegalPageAgreementExemptPaths(tenantId, locale, accessToken);
};
