import { isUnauthenticatedRpcError } from "@publira/api-client/errors";

import { resolveAccessToken } from "#lib/api-client";
import {
  ACCOUNT_DELETION_PATH,
  LEGAL_PAGE_AGREEMENT_PATH,
} from "#lib/legal-page-agreement-path";
import { getOwedLegalPages } from "#lib/legal-page-agreements";
import { getLocale, tenantDefaultLocale } from "#lib/locale";
import { withLocalePrefix } from "#lib/locale-path";
import { getTenantId } from "#lib/tenant-id";

import { LegalPageAgreementRedirect } from "./legal-page-agreement-redirect";

/**
 * Asks a signed-in reader who has not agreed to the version of the tenant's
 * terms of service or privacy policy in force to agree to it, on whichever
 * page of the site they open first.
 *
 * The public API lets such a reader read what they own and refuses most of
 * what they do, so waiting for a refusal would ask only the readers who try to
 * do something. A failed read asks nothing: the API still refuses, and
 * `withPublicSessionReauth` turns that refusal into the same screen.
 */
export const LegalPageAgreementGate = async () => {
  // The session is read outside the `try`: while the route prerenders, the
  // read never settles and rejects once the prerender is complete, which is
  // React's to handle rather than a failure of this read to report.
  const [tenantId, locale, accessToken] = await Promise.all([
    getTenantId(),
    getLocale(),
    resolveAccessToken(),
  ]);
  if (!accessToken) {
    return null;
  }

  let owedPages: Awaited<ReturnType<typeof getOwedLegalPages>>;
  try {
    owedPages = await getOwedLegalPages(tenantId, locale, accessToken);
  } catch (error) {
    // A session the API turned away is the pages' to send to sign-in.
    if (!isUnauthenticatedRpcError(error)) {
      console.warn("[web-storefront] getMyLegalPageAgreements failed", error);
    }
    return null;
  }
  if (owedPages.length === 0) {
    return null;
  }

  const defaultLocale = await tenantDefaultLocale();

  return (
    <LegalPageAgreementRedirect
      agreementPath={withLocalePrefix(
        locale,
        defaultLocale,
        LEGAL_PAGE_AGREEMENT_PATH
      )}
      exemptPaths={[
        ...owedPages.map((page) => page.href),
        ACCOUNT_DELETION_PATH,
      ]}
    />
  );
};
