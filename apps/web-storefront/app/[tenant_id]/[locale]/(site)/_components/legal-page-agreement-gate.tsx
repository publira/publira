import { resolveAccessToken } from "#lib/api-client";
import { checkLegalPageAgreementAction } from "#lib/legal-page-agreement-actions";
import { LEGAL_PAGE_AGREEMENT_PATH } from "#lib/legal-page-agreement-path";
import { readLegalPageAgreementExemptPaths } from "#lib/legal-page-agreements";
import { getLocale, tenantDefaultLocale } from "#lib/locale";
import { withLocalePrefix } from "#lib/locale-path";
import { getTenantId } from "#lib/tenant-id";

import { LegalPageAgreementRedirect } from "./legal-page-agreement-redirect";

/**
 * Asks a signed-in reader who has not agreed to the version of the tenant's
 * terms of service or privacy policy in force to agree to it, on whichever
 * page of the site they open next.
 *
 * The public API lets such a reader read what they own and refuses most of
 * what they do, so waiting for a refusal would ask only the readers who try to
 * do something. This read answers the page the layout is rendered for; the
 * client asks again after each client-side navigation, which keeps the layout.
 */
export const LegalPageAgreementGate = async () => {
  // The session is read outside the read below, which swallows its failures:
  // while the route prerenders, this read never settles and rejects once the
  // prerender is complete, which is React's to handle rather than a failure
  // to report.
  const [tenantId, locale, accessToken] = await Promise.all([
    getTenantId(),
    getLocale(),
    resolveAccessToken(),
  ]);
  if (!accessToken) {
    return null;
  }

  const [exemptPaths, defaultLocale] = await Promise.all([
    readLegalPageAgreementExemptPaths(tenantId, locale, accessToken),
    tenantDefaultLocale(),
  ]);

  return (
    <LegalPageAgreementRedirect
      agreementPath={withLocalePrefix(
        locale,
        defaultLocale,
        LEGAL_PAGE_AGREEMENT_PATH
      )}
      check={checkLegalPageAgreementAction.bind(null, tenantId, locale)}
      exemptPaths={exemptPaths}
    />
  );
};
