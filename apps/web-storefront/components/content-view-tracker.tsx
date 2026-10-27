import { cookies } from "next/headers";
import { Suspense } from "react";

import { ANALYTICS_CONSENT_COOKIE_NAME } from "#lib/analytics-consent-cookie";
import { PUBLIC_SESSION_COOKIE_NAME } from "#lib/auth-shared";
import { getTenantGoogleTag } from "#lib/google-tag";
import { getTenantId } from "#lib/tenant-id";
import type { ContentViewKind } from "#lib/view-events";

import { ContentViewBeacon } from "./content-view-beacon";

interface ContentViewTrackerProps {
  /** The internal ID of the series or episode the page shows. */
  id: string;
  kind: ContentViewKind;
}

/**
 * The session cookie is read only where the tenant asks first, so a detail
 * page of any other tenant still reads nothing per request. A signed-in
 * reader's view is filed under their account and leaves nothing new in the
 * browser, so it is sent without waiting for the banner.
 */
const ConsentAwareBeacon = async ({ id, kind }: ContentViewTrackerProps) => {
  const settings = await getTenantGoogleTag(await getTenantId());
  if (settings?.consentMode !== "opt_in") {
    return <ContentViewBeacon id={id} kind={kind} />;
  }

  const cookieStore = await cookies();
  const signedIn = Boolean(cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value);
  return signedIn ? (
    <ContentViewBeacon id={id} kind={kind} />
  ) : (
    <ContentViewBeacon
      consentCookieName={ANALYTICS_CONSENT_COOKIE_NAME}
      id={id}
      kind={kind}
    />
  );
};

/**
 * Reports the soft page view for the detail page it is placed on, once the
 * reader may be counted. It renders nothing, so its boundary has no fallback.
 */
export const ContentViewTracker = (props: ContentViewTrackerProps) => (
  <Suspense fallback={null}>
    <ConsentAwareBeacon {...props} />
  </Suspense>
);
