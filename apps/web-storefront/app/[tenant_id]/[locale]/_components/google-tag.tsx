import { ANALYTICS_CONSENT_COOKIE_NAME } from "#lib/analytics-consent-cookie";
import { getTenantGoogleTag } from "#lib/google-tag";
import { googleTagScripts } from "#lib/google-tag-scripts";
import { getTenantPublicOrigin } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { GoogleTagLoader } from "./google-tag-loader";

/**
 * The tenant's Google tag, or nothing for a tenant that has set no ID. Both
 * reads are cached per tenant, so a prerendered route stays prerendered; the
 * root layout renders this inside a `<Suspense>` of its own.
 */
export const GoogleTag = async () => {
  const tenantId = await getTenantId();
  const settings = await getTenantGoogleTag(tenantId);

  if (!settings) {
    return null;
  }

  const origin =
    settings.serving.mode === "gateway"
      ? await getTenantPublicOrigin(tenantId)
      : null;

  const scripts = googleTagScripts(settings, origin);

  if (!scripts) {
    return null;
  }

  return settings.consentMode === "not_required" ? (
    <GoogleTagLoader {...scripts} />
  ) : (
    <GoogleTagLoader
      {...scripts}
      consent={{
        cookieName: ANALYTICS_CONSENT_COOKIE_NAME,
        mode: settings.consentMode,
      }}
    />
  );
};
