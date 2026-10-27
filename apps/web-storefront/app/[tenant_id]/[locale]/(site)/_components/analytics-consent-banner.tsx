import { ANALYTICS_CONSENT_COOKIE_NAME } from "#lib/analytics-consent-cookie";
import { getTenantGoogleTag } from "#lib/google-tag";
import { getLocale } from "#lib/locale";
import { getTenantLegalPages } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { AnalyticsConsentPrompt } from "./analytics-consent-prompt";

/**
 * The consent banner of a tenant that asks before its Google tag runs, and
 * nothing for any other. Both reads are cached per tenant and name no reader,
 * so the chrome keeps its static shell.
 */
export const AnalyticsConsentBanner = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const settings = await getTenantGoogleTag(tenantId);
  if (settings?.consentMode !== "opt_in") {
    return null;
  }

  const { privacyPage } = await getTenantLegalPages(tenantId, locale);
  return (
    <AnalyticsConsentPrompt
      cookieName={ANALYTICS_CONSENT_COOKIE_NAME}
      privacyPage={
        privacyPage && { href: privacyPage.href, title: privacyPage.title }
      }
    />
  );
};
