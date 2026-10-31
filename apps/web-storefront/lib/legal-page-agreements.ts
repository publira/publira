import {
  isUnauthenticatedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import type { GetMyLegalPageAgreementsResponse } from "@publira/api-client/public/auth";
import type { Locale } from "@publira/i18n";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { legalPageAgreementExemptPaths } from "./legal-page-agreement-path";
import { consentPages, toTenantLegalPage } from "./tenant";
import type { TenantLegalPage } from "./tenant";

/**
 * The fields of `GetMyLegalPageAgreementsResponse` {@link toOwedPages} reads,
 * which `AgreeToLegalPagesResponse` carries too.
 */
type RawOwedPages = Pick<
  GetMyLegalPageAgreementsResponse,
  "privacyPage" | "termsPage"
>;

const toOwedPages = (response: RawOwedPages): TenantLegalPage[] =>
  consentPages({
    privacyPage: toTenantLegalPage(response.privacyPage),
    termsPage: toTenantLegalPage(response.termsPage),
  });

/**
 * The pages the signed-in reader has still to agree to, each in the version in
 * force for `locale` and each once, as a sign-up lists them. Empty for a reader
 * who owes nothing and for a browser holding no session.
 *
 * Read past every cache: a Tenant admin who publishes a revision asks every
 * reader at once, and an agreement has to name a version the reader is shown.
 */
export const getOwedLegalPages = async (
  tenantId: string,
  locale: Locale,
  accessToken?: string
): Promise<TenantLegalPage[]> => {
  const sid = await resolveAccessToken(accessToken);

  if (!sid) {
    return [];
  }

  const response = await apiClient.auth.getMyLegalPageAgreements(
    { locale, tenant: { tenantId } },
    buildSessionHeaders(sid)
  );

  return toOwedPages(response);
};

/**
 * {@link legalPageAgreementExemptPaths} for the reader `accessToken` signs in,
 * which is `null` for one who owes nothing, for the site's gate. A failed read
 * asks nothing: the API still refuses such a reader, and
 * `withPublicSessionReauth` turns that refusal into the agreement screen.
 */
export const readLegalPageAgreementExemptPaths = async (
  tenantId: string,
  locale: Locale,
  accessToken: string
): Promise<string[] | null> => {
  try {
    const pages = await getOwedLegalPages(tenantId, locale, accessToken);

    return legalPageAgreementExemptPaths(pages.map((page) => page.href));
  } catch (error) {
    // A session the API turned away is the pages' to send to sign-in.
    if (!isUnauthenticatedRpcError(error)) {
      console.warn("[web-storefront] getMyLegalPageAgreements failed", error);
    }

    return null;
  }
};

/**
 * `agreed` once the reader owes nothing, and `changed` when what they agreed
 * to is no longer what the tenant asks: a version published since the screen
 * was drawn, or a page the tenant no longer names, which the API refuses as
 * `invalid_argument`.
 */
export type LegalPageAgreementOutcome = "agreed" | "changed";

/**
 * Records the signed-in reader's agreement to the versions they were shown.
 * Every other refusal propagates, `unauthenticated` included.
 */
export const agreeToLegalPages = async (
  tenantId: string,
  locale: Locale,
  agreedPageVersionIds: string[],
  accessToken: string
): Promise<LegalPageAgreementOutcome> => {
  try {
    const response = await apiClient.auth.agreeToLegalPages(
      { agreedPageVersionIds, locale, tenant: { tenantId } },
      buildSessionHeaders(accessToken)
    );

    return toOwedPages(response).length === 0 ? "agreed" : "changed";
  } catch (error) {
    if (rpcErrorDisposition(error) === "invalid-argument") {
      return "changed";
    }

    throw error;
  }
};
